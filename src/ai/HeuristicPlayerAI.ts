import { RandomPlayerAI, Dex, Streams } from '@pkmn/sim';
import type { AnyObject, PokemonSet } from '@pkmn/sim';
import type { MoveCandidate } from './moveCandidates.js';
import { isFixedLevelDamageMove, variableMovePower, VARIABLE_POWER_FALLBACK } from './damageHeuristic.js';
import { LEVEL_CAP } from '../roster/roster.js';

type ChoiceRequest = Parameters<RandomPlayerAI['receiveRequest']>[0];

const FOE_TARGETABLE = new Set(['normal', 'any', 'adjacentFoe']);
const STATUS_MOVE_SCORE = -1;

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
  // Which of `ownTeam` corresponds to each live active slot for the current
  // request, in the order `chooseMove` will actually be called - see
  // `receiveRequest` for why this can't just be `ownTeam[moveCallIndex]`.
  private attackerQueue: PokemonSet[] = [];

  // Publicly-revealed opponent state, tracked from protocol lines rather
  // than peeked from engine internals - mirrors what a real client would
  // see (HP as the protocol reports it, which is already percentage-only
  // for gen7+ formats unless the format reveals exact numbers).
  protected readonly foeSpecies: [string | undefined, string | undefined] = [undefined, undefined];
  protected readonly foeFainted: [boolean, boolean] = [false, false];
  protected readonly foeHealth: [{ hp: number; maxhp: number }, { hp: number; maxhp: number }] = [
    { hp: 1, maxhp: 1 },
    { hp: 1, maxhp: 1 },
  ];

  constructor(
    playerStream: Streams.ObjectReadWriteStream<string>,
    protected readonly ownTeam: PokemonSet[],
    format = 'gen9doublescustomgame'
  ) {
    super(playerStream);
    this.dex = Dex.forFormat(format);
  }

  override receiveRequest(request: ChoiceRequest): void {
    this.mySide = request.side.id;
    if ('active' in request && request.active) {
      // `chooseMove` is only invoked for slots that are still alive - a
      // fainted slot gets an implicit 'pass' with no call - so a plain
      // per-call counter into `ownTeam` desyncs from the true slot index as
      // soon as an earlier slot is the first to faint. Precompute, in the
      // same live/fainted order the engine will actually call in, which
      // `ownTeam` member each upcoming `chooseMove` call belongs to.
      const pokemon = (request as AnyObject).side.pokemon as AnyObject[];
      this.attackerQueue = pokemon
        .slice(0, request.active.length)
        .map((p, i) => (String(p.condition).endsWith(' fnt') ? undefined : this.ownTeam[i]))
        .filter((mon): mon is PokemonSet => mon !== undefined);
      this.moveCallIndex = 0;
    }
    super.receiveRequest(request);
  }

  override receiveLine(line: string): void {
    super.receiveLine(line);

    const switchMatch = /^\|(?:switch|drag)\|(p\d)([ab]): [^|]*\|([^|]+)\|([^|]+)/.exec(line);
    if (switchMatch) {
      const [, side, slot, details, health] = switchMatch;
      if (side !== this.mySide) {
        const idx = slot === 'a' ? 0 : 1;
        this.foeSpecies[idx] = details!.split(',')[0]!.trim();
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

  protected override chooseMove(active: AnyObject, moves: MoveCandidate[]): string {
    const attacker = this.attackerQueue[this.moveCallIndex];
    this.moveCallIndex++;

    let best: ScoredChoice | undefined;
    for (const candidate of moves) {
      for (const scored of this.scoreCandidate(candidate, attacker)) {
        if (!best || scored.score > best.score) best = scored;
      }
    }
    return best ? best.choice : moves[0]!.choice;
  }

  private scoreCandidate(candidate: MoveCandidate, attacker: PokemonSet | undefined): ScoredChoice[] {
    const moveData = this.dex.moves.get(candidate.move.move);

    if (moveData.category === 'Status') {
      return [{ choice: candidate.choice, score: STATUS_MOVE_SCORE }];
    }

    const attackerTypes = attacker ? this.dex.species.get(attacker.species).types : [];
    const attackerWeightKg = attacker ? this.dex.species.get(attacker.species).weightkg : undefined;
    const stab = attackerTypes.includes(moveData.type) ? 1.5 : 1;
    const fixedLevelDamage = isFixedLevelDamageMove(moveData.id);

    // Base power against a specific foe - a per-foe computation (rather than
    // one basePower shared by every target) because weight/HP-based moves
    // like Low Kick genuinely hit harder against some foes than others (e.g.
    // heavier ones), and Seismic Toss/Night Shade skip STAB and type-
    // effectiveness scaling entirely (only immunity, via effectivenessMultiplier
    // returning 0, still zeroes it out).
    const scoreAgainst = (foeIdx: 0 | 1): number => {
      const effectiveness = this.effectivenessMultiplier(moveData.type, foeIdx);
      if (effectiveness === 0) return 0;
      if (fixedLevelDamage) return LEVEL_CAP;
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
      const fallbackPower = fixedLevelDamage ? LEVEL_CAP : moveData.basePower || VARIABLE_POWER_FALLBACK;
      return [{ choice: candidate.choice, score: fixedLevelDamage ? fallbackPower : fallbackPower * stab }];
    }

    const liveFoe = this.foeFainted[0] ? (this.foeFainted[1] ? undefined : 1) : 0;
    if (liveFoe === undefined) {
      const fallbackPower = fixedLevelDamage ? LEVEL_CAP : moveData.basePower || VARIABLE_POWER_FALLBACK;
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
}
