import type { AnyObject, PokemonSet, Streams } from '@pkmn/sim';
import { HeuristicPlayerAI } from './HeuristicPlayerAI.js';
import { deriveMoveCandidates, type MoveCandidate } from './moveCandidates.js';
import { bestHit, jointValue, type FoeLike } from './damageHeuristic.js';
import type { MoveDecisionSnapshot } from './decisionSnapshot.js';

type ChoiceRequest = Parameters<HeuristicPlayerAI['receiveRequest']>[0];

/**
 * Doubles-aware move selection: jointly searches both of this side's active
 * slots' move+target combinations (spread moves, focus-firing a KO neither
 * slot could get alone, avoiding 'allAdjacent' friendly fire on its own
 * ally) against the foe, scored purely from publicly
 * revealed information - the same foeSpecies/foeFainted/foeHealth tracking
 * HeuristicPlayerAI already builds from protocol lines. Never peeks at
 * engine internals or the foe's hidden moveset; a real client wouldn't know
 * either. Pure arithmetic reusing HeuristicPlayerAI's basePower x STAB x
 * effectiveness scoring - no battle cloning, no engine turns run, no RNG
 * consumed, so it's identically cheap and deterministic whether called once
 * for a single battle or millions of times in a batch.
 *
 * Falls back to the inherited per-slot heuristic (via super.receiveRequest)
 * for anything outside a plain two-active-slot move turn - forced switches,
 * team preview, or once either side is down to one live mon (once a slot's
 * gone this isn't really a joint decision anymore) - and never opts into
 * Terastallize/Dynamax/Mega Evolution/Z-Move (declining them is always
 * legal, and gen9 custom games only expose Terastallize in practice).
 */
export class DoublesPlayerAI extends HeuristicPlayerAI {
  constructor(
    playerStream: Streams.ObjectReadWriteStream<string>,
    ownTeam: PokemonSet[],
    format = 'gen9doublescustomgame',
    onDecision?: (snapshot: MoveDecisionSnapshot) => void
  ) {
    super(playerStream, ownTeam, format, onDecision);
  }

  override receiveRequest(request: ChoiceRequest): void {
    this.mySide = (request as AnyObject).side.id;

    try {
      if (!this.tryJointMove(request as AnyObject)) super.receiveRequest(request);
    } catch {
      super.receiveRequest(request);
    }
  }

  /** Returns true if it fully handled the request (submitted a choice), false to fall back. */
  private tryJointMove(request: AnyObject): boolean {
    if (!request.active || request.active.length !== 2) return false;
    // request.active always keeps one entry per active slot regardless of
    // fainted status (a fainted slot still lists moves and must be sent
    // "pass" explicitly) - so liveness has to come from side.pokemon's
    // condition, not the length of active.
    const myPokemon = request.side.pokemon as AnyObject[];
    if (myPokemon.some((p, i) => i < 2 && String(p.condition).endsWith(' fnt'))) return false;
    // Foe liveness/identity is only known from what's been revealed so far.
    if (this.foeFainted[0] || this.foeFainted[1]) return false;
    if (!this.foeSpecies[0] || !this.foeSpecies[1]) return false;

    const myCandidates = (request.active as AnyObject[]).map((a) => deriveMoveCandidates(a, true));
    if (myCandidates.some((c) => !c.length)) return false;

    const foeAsTargets: FoeLike[] = ([0, 1] as const).map((idx) => {
      const species = this.dex.species.get(this.foeSpecies[idx]!);
      return {
        types: species.types,
        weightkg: species.weightkg,
        level: this.foeLevel[idx],
        hp: this.foeHealth[idx].hp,
        maxhp: this.foeHealth[idx].maxhp,
        fainted: this.foeFainted[idx],
        // Only read by status-move valuation, so a second Growl into an
        // already -1 Atk foe is priced as the smaller gain it is.
        status: this.foeStatus[idx],
        boosts: this.foeBoosts[idx],
      };
    });

    // Both slots are confirmed live above, so each one's "ally" for
    // 'allAdjacent' friendly-fire scoring is simply the other slot. Identity
    // comes from `resolveOwnIdentity` (request data), not `ownTeam[idx]`
    // directly - same reasoning as `HeuristicPlayerAI.attackerQueue`.
    const toMyFoeLike = (idx: 0 | 1): FoeLike => {
      const identity = this.resolveOwnIdentity(idx, myPokemon);
      const species = this.dex.species.get(identity!.species);
      const health = /(\d+)\/(\d+)/.exec(String(myPokemon[idx]?.condition));
      return {
        types: species.types,
        weightkg: species.weightkg,
        level: identity?.level,
        hp: health ? Number(health[1]) : 1,
        maxhp: health ? Number(health[2]) : 1,
        fainted: false,
        boosts: this.ownBoosts[idx],
      };
    };
    const myAsAllies: [FoeLike, FoeLike] = [toMyFoeLike(0), toMyFoeLike(1)];
    const alliesBySlot: [FoeLike, FoeLike] = [myAsAllies[1], myAsAllies[0]];

    const slotA = myCandidates[0]!;
    const slotB = myCandidates[1]!;
    let best: { pair: [MoveCandidate, MoveCandidate]; value: number } | undefined;
    for (const a of slotA) {
      for (const b of slotB) {
        const value = jointValue(this.dex, [a, b], myAsAllies, foeAsTargets, alliesBySlot);
        if (!best || value > best.value) best = { pair: [a, b], value };
      }
    }
    if (!best) return false;

    const choiceA = bestHit(this.dex, best.pair[0], myAsAllies[0], foeAsTargets, alliesBySlot[0]).choice;
    const choiceB = bestHit(this.dex, best.pair[1], myAsAllies[1], foeAsTargets, alliesBySlot[1]).choice;
    this.emitDecision(myPokemon, 0, slotA, choiceA);
    this.emitDecision(myPokemon, 1, slotB, choiceB);
    this.choose(`${choiceA}, ${choiceB}`);
    return true;
  }
}
