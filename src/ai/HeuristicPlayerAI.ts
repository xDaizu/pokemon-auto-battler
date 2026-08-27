import { RandomPlayerAI, Dex, Streams } from '@pkmn/sim';
import type { AnyObject, PokemonSet } from '@pkmn/sim';
import type { MoveCandidate } from './moveCandidates.js';
import {
  bestStatusHit,
  estimateDamageScore,
  isFixedLevelDamageMove,
  variableMovePower,
  UNKNOWN_LEVEL_FALLBACK,
  VARIABLE_POWER_FALLBACK,
  type FoeLike,
} from './damageHeuristic.js';
import {
  parseCondition,
  parseDetails,
  type MoveDecisionSnapshot,
  type ParsedDetails,
  type SlotPublicState,
} from './decisionSnapshot.js';

type ChoiceRequest = Parameters<RandomPlayerAI['receiveRequest']>[0];

const FOE_TARGETABLE = new Set(['normal', 'any', 'adjacentFoe']);

interface ScoredChoice {
  choice: string;
  score: number;
}

/**
 * Move-selection AI used for both sides of the battle. Picks the legal
 * move+target combo that maximizes a basePower x STAB x type-effectiveness
 * heuristic, falling back to status moves only when no damaging move is
 * available. Built entirely on @pkmn/sim's own Dex rather than a separate
 * damage-calculator package.
 *
 * Extends RandomPlayerAI (not BattlePlayer directly) to reuse its
 * already-correct handling of disabled-move filtering, forced switches,
 * team preview, and doubles choice-string formatting - only the move
 * (and opponent tracking) extension points are overridden.
 */
export class HeuristicPlayerAI extends RandomPlayerAI {
  protected readonly dex: ReturnType<typeof Dex.forFormat>;
  protected mySide = '';
  private moveCallIndex = 0;
  // The species+level actually occupying each live active slot for the
  // current request, in the order `chooseMove` will actually be called - see
  // `resolveOwnIdentity` for why this can't just be `ownTeam[moveCallIndex]`.
  private attackerQueue: ParsedDetails[] = [];
  // The original active-slot index (0='a', 1='b') for each queued
  // `chooseMove` call, built in lockstep with `attackerQueue` - lets
  // `emitDecision` label a decision with the slot it was actually for.
  private slotQueue: (0 | 1)[] = [];
  // `request.side.pokemon` from the most recent `receiveRequest`, needed by
  // `chooseMove` (which isn't handed the request itself) to read this side's
  // own exact HP/status for the decision snapshot.
  private lastOwnPokemon: AnyObject[] = [];

  // Publicly-revealed opponent state, tracked from protocol lines rather
  // than peeked from engine internals - mirrors what a real client would
  // see (HP as the protocol reports it, which is already percentage-only
  // for gen7+ formats unless the format reveals exact numbers).
  protected readonly foeSpecies: [string | undefined, string | undefined] = [undefined, undefined];
  // Alongside foeSpecies - needed by Seismic Toss/Night Shade's flat
  // user-level damage when the *foe* is the one using it (see FoeLike.level).
  protected readonly foeLevel: [number | undefined, number | undefined] = [undefined, undefined];
  protected readonly foeFainted: [boolean, boolean] = [false, false];
  protected readonly foeHealth: [{ hp: number; maxhp: number }, { hp: number; maxhp: number }] = [
    { hp: 1, maxhp: 1 },
    { hp: 1, maxhp: 1 },
  ];
  // Same "only what's been revealed" rule applied to status and stat boosts,
  // for both sides - own status/boosts aren't in the request object, and
  // there's no reason to read them differently from the foe's once we're
  // parsing protocol lines anyway. Used only to build decision snapshots
  // (see `decisionSnapshot.ts`), never by the scoring heuristic itself.
  protected readonly foeStatus: [string | undefined, string | undefined] = [undefined, undefined];
  protected readonly ownBoosts: [Record<string, number>, Record<string, number>] = [{}, {}];
  protected readonly foeBoosts: [Record<string, number>, Record<string, number>] = [{}, {}];
  protected turn = 0;
  protected weather: string | undefined;

  // Reported to whoever is collecting battle telemetry (see `runBattle.ts`)
  // every time this AI actually commits to a move choice - absent for a
  // plain `HeuristicPlayerAI` used standalone (e.g. in tests) that doesn't
  // care about it.
  private readonly onDecision?: (snapshot: MoveDecisionSnapshot) => void;

  constructor(
    playerStream: Streams.ObjectReadWriteStream<string>,
    protected readonly ownTeam: PokemonSet[],
    format = 'gen9doublescustomgame',
    onDecision?: (snapshot: MoveDecisionSnapshot) => void
  ) {
    super(playerStream);
    this.dex = Dex.forFormat(format);
    this.onDecision = onDecision;
  }

  override receiveRequest(request: ChoiceRequest): void {
    this.mySide = request.side.id;
    if ('active' in request && request.active) {
      const pokemon = (request as AnyObject).side.pokemon as AnyObject[];
      this.lastOwnPokemon = pokemon;
      // `chooseMove` is only invoked for slots that are still alive - a
      // fainted slot gets an implicit 'pass' with no call - so a plain
      // per-call counter desyncs from the true slot index as soon as an
      // earlier slot is the first to faint. Precompute, in the same
      // live/fainted order the engine will actually call in, which identity
      // (and original slot index) each upcoming `chooseMove` call belongs to.
      const entries = pokemon
        .slice(0, request.active.length)
        .map((p, i) => ({ i, mon: this.resolveOwnIdentity(i, pokemon), fainted: String(p.condition).endsWith(' fnt') }))
        .filter((e): e is { i: number; mon: ParsedDetails; fainted: boolean } => !e.fainted && e.mon !== undefined);
      this.attackerQueue = entries.map((e) => e.mon);
      this.slotQueue = entries.map((e) => (e.i === 0 ? 0 : 1));
      this.moveCallIndex = 0;
    }
    super.receiveRequest(request);
  }

  /**
   * Resolves the species+level actually occupying own active slot `idx`, for
   * a given `pokemon` array (`request.side.pokemon`, already reordered by
   * Showdown so active slots lead - see the class comment on `attackerQueue`
   * below). Reads `details` (public request data, not an engine internal -
   * invariant 5), never `ownTeam[idx]`: `ownTeam` is index-stable across the
   * whole battle in original team-build order, so it only agrees with the
   * live active slot for a team with no bench. The moment a bench Pokemon
   * switches in, `ownTeam[idx]` silently names the wrong Pokemon.
   *
   * Falls back to `ownTeam[idx]` when the request carries no `details` -
   * synthetic test requests build `{ condition }` only.
   */
  protected resolveOwnIdentity(idx: number, pokemon: AnyObject[]): ParsedDetails | undefined {
    const details = pokemon[idx]?.details;
    if (typeof details === 'string' && details.length > 0) return parseDetails(details);
    const fallback = this.ownTeam[idx];
    return fallback ? { species: fallback.species, level: fallback.level } : undefined;
  }

  override receiveLine(line: string): void {
    super.receiveLine(line);

    const turnMatch = /^\|turn\|(\d+)/.exec(line);
    if (turnMatch) {
      this.turn = Number(turnMatch[1]);
      return;
    }

    const switchMatch = /^\|(?:switch|drag)\|(p\d)([ab]): [^|]*\|([^|]+)\|([^|]+)/.exec(line);
    if (switchMatch) {
      const [, side, slot, details, health] = switchMatch;
      if (side !== this.mySide) {
        const idx = slot === 'a' ? 0 : 1;
        const parsed = parseDetails(details!);
        this.foeSpecies[idx] = parsed.species;
        this.foeLevel[idx] = parsed.level;
        this.foeFainted[idx] = false;
        this.updateFoeHealth(idx, health!);
      }
      return;
    }

    const healthMatch = /^\|-(?:damage|heal)\|(p\d)([ab]): [^|]*\|([^|]+)/.exec(line);
    if (healthMatch) {
      const [, side, slot, health] = healthMatch;
      if (side !== this.mySide) {
        this.updateFoeHealth(slot === 'a' ? 0 : 1, health!);
      }
      return;
    }

    const faintMatch = /^\|faint\|(p\d)([ab]):/.exec(line);
    if (faintMatch) {
      const [, side, slot] = faintMatch;
      if (side !== this.mySide) {
        const idx = slot === 'a' ? 0 : 1;
        this.foeFainted[idx] = true;
        this.foeHealth[idx] = { hp: 0, maxhp: this.foeHealth[idx].maxhp };
      }
      return;
    }

    const weatherMatch = /^\|-weather\|([^|]+)/.exec(line);
    if (weatherMatch) {
      const weather = weatherMatch[1]!.trim();
      if (!line.includes('[upkeep]')) this.weather = weather === 'none' ? undefined : weather;
      return;
    }

    const statusMatch = /^\|-status\|(p\d)([ab]): [^|]*\|([a-z]+)/.exec(line);
    if (statusMatch) {
      const [, side, slot, status] = statusMatch;
      if (side !== this.mySide) this.foeStatus[slot === 'a' ? 0 : 1] = status;
      return;
    }

    const curestatusMatch = /^\|-curestatus\|(p\d)([ab]):/.exec(line);
    if (curestatusMatch) {
      const [, side, slot] = curestatusMatch;
      if (side !== this.mySide) this.foeStatus[slot === 'a' ? 0 : 1] = undefined;
      return;
    }

    const boostMatch = /^\|(-boost|-unboost)\|(p\d)([ab]): [^|]*\|([a-z]+)\|(\d+)/.exec(line);
    if (boostMatch) {
      const [, kind, side, slot, stat, amount] = boostMatch;
      const idx = slot === 'a' ? 0 : 1;
      const delta = (kind === '-boost' ? 1 : -1) * Number(amount);
      const bucket = side === this.mySide ? this.ownBoosts[idx] : this.foeBoosts[idx];
      bucket[stat!] = (bucket[stat!] ?? 0) + delta;
    }
  }

  private updateFoeHealth(idx: 0 | 1, health: string): void {
    const parsed = /(\d+)\/(\d+)/.exec(health);
    if (parsed) {
      this.foeHealth[idx] = { hp: Number(parsed[1]), maxhp: Number(parsed[2]) };
    } else if (/^0(?:\s|$)/.test(health)) {
      this.foeHealth[idx] = { hp: 0, maxhp: this.foeHealth[idx].maxhp };
    }
  }

  /** Builds and reports a `MoveDecisionSnapshot` for one slot's just-made
   * choice - a no-op if nobody's listening (`onDecision` unset). `ownPokemon`
   * is passed in rather than read off `this` because the doubles joint path
   * (`DoublesPlayerAI.tryJointMove`) calls this without ever going through
   * `receiveRequest`'s own bookkeeping. */
  protected emitDecision(
    ownPokemon: AnyObject[],
    slotIdx: 0 | 1,
    candidates: MoveCandidate[],
    chosenChoice: string
  ): void {
    if (!this.onDecision) return;
    this.onDecision({
      turn: this.turn,
      side: this.mySide as 'p1' | 'p2',
      slot: slotIdx === 0 ? 'a' : 'b',
      weather: this.weather,
      own: this.buildOwnStates(ownPokemon),
      foe: this.buildFoeStates(),
      legalMoves: candidates.map((c) => ({ move: c.move.move, target: c.move.target })),
      chosenChoice,
    });
  }

  private buildOwnStates(ownPokemon: AnyObject[]): [SlotPublicState, SlotPublicState] {
    return [0, 1].map((i) => ({
      species: this.resolveOwnIdentity(i, ownPokemon)?.species,
      ...parseCondition(String(ownPokemon[i]?.condition ?? '')),
      boosts: { ...this.ownBoosts[i as 0 | 1] },
    })) as [SlotPublicState, SlotPublicState];
  }

  private buildFoeStates(): [SlotPublicState, SlotPublicState] {
    return [0, 1].map((i) => {
      const idx = i as 0 | 1;
      return {
        species: this.foeSpecies[idx],
        hp: this.foeHealth[idx].hp,
        maxhp: this.foeHealth[idx].maxhp,
        status: this.foeStatus[idx],
        fainted: this.foeFainted[idx],
        boosts: { ...this.foeBoosts[idx] },
      };
    }) as [SlotPublicState, SlotPublicState];
  }

  protected override chooseMove(active: AnyObject, moves: MoveCandidate[]): string {
    const slotIdx = this.slotQueue[this.moveCallIndex] ?? 0;
    const attacker = this.attackerQueue[this.moveCallIndex];
    this.moveCallIndex++;

    let best: ScoredChoice | undefined;
    for (const candidate of moves) {
      for (const scored of this.scoreCandidate(candidate, attacker, slotIdx)) {
        if (!best || scored.score > best.score) best = scored;
      }
    }
    const choice = best ? best.choice : moves[0]!.choice;
    this.emitDecision(this.lastOwnPokemon, slotIdx, moves, choice);
    return choice;
  }

  /** This side's slot `idx` as a `FoeLike`, for status valuation only - the
   * damaging path below reads the same data straight off `this`. `attacker`
   * is the identity already resolved for this slot by the caller
   * (`scoreCandidate`) - not re-derived from `ownTeam[slotIdx]`, which would
   * reintroduce the stale-index bug once a bench Pokemon has switched in. */
  private ownAsFoeLike(slotIdx: 0 | 1, attacker: ParsedDetails | undefined): FoeLike {
    const species = attacker ? this.dex.species.get(attacker.species) : undefined;
    const { hp, maxhp, status, fainted } = parseCondition(String(this.lastOwnPokemon[slotIdx]?.condition ?? ''));
    return {
      types: species?.types ?? [],
      weightkg: species?.weightkg,
      level: attacker?.level,
      hp,
      maxhp,
      fainted,
      status,
      boosts: this.ownBoosts[slotIdx],
    };
  }

  private foeAsFoeLike(idx: 0 | 1): FoeLike {
    const species = this.foeSpecies[idx];
    const data = species ? this.dex.species.get(species) : undefined;
    return {
      types: data?.types ?? [],
      weightkg: data?.weightkg,
      level: this.foeLevel[idx],
      hp: this.foeHealth[idx].hp,
      maxhp: this.foeHealth[idx].maxhp,
      fainted: this.foeFainted[idx],
      status: this.foeStatus[idx],
      boosts: this.foeBoosts[idx],
    };
  }

  private scoreCandidate(
    candidate: MoveCandidate,
    attacker: ParsedDetails | undefined,
    slotIdx: 0 | 1
  ): ScoredChoice[] {
    const moveData = this.dex.moves.get(candidate.move.move);

    // Status moves are scored on the same scale as attacks (see
    // damageHeuristic.ts) rather than pinned below them, so a mon whose whole
    // movepool is resisted debuffs instead of chipping.
    if (moveData.category === 'Status') {
      const hit = bestStatusHit(this.dex, candidate, this.ownAsFoeLike(slotIdx, attacker), [
        this.foeAsFoeLike(0),
        this.foeAsFoeLike(1),
      ]);
      return [{ choice: hit.choice, score: hit.value }];
    }

    const attackerTypes = attacker ? this.dex.species.get(attacker.species).types : [];
    const attackerWeightKg = attacker ? this.dex.species.get(attacker.species).weightkg : undefined;
    const stab = attackerTypes.includes(moveData.type) ? 1.5 : 1;
    const fixedLevelDamage = isFixedLevelDamageMove(moveData.id);
    // Seismic Toss/Night Shade deal damage equal to the *attacker's* real
    // level, not a shared format-wide cap - each leader's team (and each
    // slot within it) can now sit at a different level.
    const attackerLevel = attacker?.level ?? UNKNOWN_LEVEL_FALLBACK;

    // Base power against a specific foe - a per-foe computation (rather than
    // one basePower shared by every target) because weight/HP-based moves
    // like Low Kick genuinely hit harder against some foes than others (e.g.
    // heavier ones), and Seismic Toss/Night Shade skip STAB and type-
    // effectiveness scaling entirely (only immunity, via effectivenessMultiplier
    // returning 0, still zeroes it out).
    const scoreAgainst = (foeIdx: 0 | 1): number => {
      const effectiveness = this.effectivenessMultiplier(moveData.type, foeIdx);
      if (effectiveness === 0) return 0;
      if (fixedLevelDamage) return attackerLevel;
      const species = this.foeSpecies[foeIdx];
      const health = this.foeHealth[foeIdx];
      const basePower =
        moveData.basePower ||
        variableMovePower(moveData.id, {
          attackerWeightKg,
          defenderWeightKg: species ? this.dex.species.get(species).weightkg : undefined,
          targetHpFraction: health.maxhp > 0 ? health.hp / health.maxhp : undefined,
          // Our own current HP isn't tracked in this singles-fallback path,
          // so Flail/Reversal fall back to VARIABLE_POWER_FALLBACK here.
        });
      return basePower * stab * effectiveness;
    };

    if (FOE_TARGETABLE.has(candidate.move.target)) {
      const results: ScoredChoice[] = [];
      for (const foeIdx of [0, 1] as const) {
        if (this.foeFainted[foeIdx]) continue;
        const choice = `move ${candidate.move.slot} ${foeIdx + 1}${candidate.move.zMove ? ' zmove' : ''}`;
        results.push({ choice, score: scoreAgainst(foeIdx) });
      }
      if (results.length) return results;
      // No tracked live foe yet (shouldn't normally happen) - fall back to the default choice.
      const fallbackPower = fixedLevelDamage ? attackerLevel : moveData.basePower || VARIABLE_POWER_FALLBACK;
      return [{ choice: candidate.choice, score: fixedLevelDamage ? fallbackPower : fallbackPower * stab }];
    }

    const liveFoe = this.foeFainted[0] ? (this.foeFainted[1] ? undefined : 1) : 0;
    if (liveFoe === undefined) {
      const fallbackPower = fixedLevelDamage ? attackerLevel : moveData.basePower || VARIABLE_POWER_FALLBACK;
      return [{ choice: candidate.choice, score: fixedLevelDamage ? fallbackPower : fallbackPower * stab }];
    }
    return [{ choice: candidate.choice, score: scoreAgainst(liveFoe) }];
  }

  private effectivenessMultiplier(moveType: string, foeIdx: 0 | 1): number {
    const species = this.foeSpecies[foeIdx];
    if (!species) return 1;
    const types = this.dex.species.get(species).types;
    if (!this.dex.getImmunity(moveType, types)) return 0;
    return 2 ** this.dex.getEffectiveness(moveType, types);
  }

  /**
   * Picks a bench Pokemon to send in - reached only via a forced switch (a
   * faint) or a pivot move (Flip Turn, ...), since `RandomPlayerAI`'s `move`
   * probability defaults to 1.0 and this AI never overrides `mega` to opt
   * into a voluntary switch on a move turn. `RandomPlayerAI`'s own
   * implementation just samples at random; this scores each candidate by the
   * best damage any of its choosable moves could do against the currently
   * revealed live foes, so a switch-in that resists or hits back hard is
   * preferred over a random one.
   *
   * Kept total and non-throwing: with no revealed live foes (shouldn't
   * happen for a switch mid-battle, but possible right after team preview)
   * or no candidates, falls back to the first legal switch.
   */
  protected override chooseSwitch(
    active: AnyObject | undefined,
    switches: { slot: number; pokemon: AnyObject }[]
  ): number {
    const firstSlot = switches[0]?.slot;
    if (firstSlot === undefined) return super.chooseSwitch(active, switches);

    const liveFoes = ([0, 1] as const)
      .filter((idx) => this.foeSpecies[idx] && !this.foeFainted[idx])
      .map((idx) => this.foeAsFoeLike(idx));
    if (!liveFoes.length) return firstSlot;

    let best: { slot: number; score: number } | undefined;
    for (const candidate of switches) {
      const identity = parseDetails(String(candidate.pokemon.details ?? ''));
      const species = this.dex.species.get(identity.species);
      const attacker: FoeLike = {
        types: species.types,
        weightkg: species.weightkg,
        level: identity.level,
        ...parseCondition(String(candidate.pokemon.condition ?? '')),
      };
      const moveIds: string[] = Array.isArray(candidate.pokemon.moves) ? candidate.pokemon.moves : [];

      const score = liveFoes.reduce((sum, foe) => {
        const bestAgainstFoe = moveIds.reduce(
          (max, moveId) => Math.max(max, estimateDamageScore(this.dex, moveId, attacker, foe)),
          0
        );
        return sum + bestAgainstFoe;
      }, 0);

      if (!best || score > best.score) best = { slot: candidate.slot, score };
    }
    return best ? best.slot : firstSlot;
  }
}
