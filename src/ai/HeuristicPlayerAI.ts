import { RandomPlayerAI, Dex, Streams } from '@pkmn/sim';
import type { AnyObject, PokemonSet } from '@pkmn/sim';

type ChoiceRequest = Parameters<RandomPlayerAI['receiveRequest']>[0];

const FOE_TARGETABLE = new Set(['normal', 'any', 'adjacentFoe']);
const STATUS_MOVE_SCORE = -1;

interface MoveCandidate {
  choice: string;
  move: { slot: number; move: string; target: string; zMove: boolean };
}

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
  private readonly dex: ReturnType<typeof Dex.forFormat>;
  private mySide = '';
  private moveCallIndex = 0;

  // Publicly-revealed opponent state, tracked from protocol lines rather
  // than peeked from config - mirrors what a real client would see.
  private readonly foeSpecies: [string | undefined, string | undefined] = [undefined, undefined];
  private readonly foeFainted: [boolean, boolean] = [false, false];

  constructor(
    playerStream: Streams.ObjectReadWriteStream<string>,
    private readonly ownTeam: PokemonSet[],
    format = 'gen9doublescustomgame'
  ) {
    super(playerStream);
    this.dex = Dex.forFormat(format);
  }

  override receiveRequest(request: ChoiceRequest): void {
    this.mySide = request.side.id;
    if ('active' in request && request.active) {
      this.moveCallIndex = 0;
    }
    super.receiveRequest(request);
  }

  override receiveLine(line: string): void {
    super.receiveLine(line);

    const switchMatch = /^\|(?:switch|drag)\|(p\d)([ab]): [^|]*\|([^,|]+)/.exec(line);
    if (switchMatch) {
      const [, side, slot, species] = switchMatch;
      if (side !== this.mySide) {
        const idx = slot === 'a' ? 0 : 1;
        this.foeSpecies[idx] = species!.trim();
        this.foeFainted[idx] = false;
      }
      return;
    }

    const faintMatch = /^\|faint\|(p\d)([ab]):/.exec(line);
    if (faintMatch) {
      const [, side, slot] = faintMatch;
      if (side !== this.mySide) {
        const idx = slot === 'a' ? 0 : 1;
        this.foeFainted[idx] = true;
      }
    }
  }

  protected override chooseMove(active: AnyObject, moves: MoveCandidate[]): string {
    const attacker = this.ownTeam[this.moveCallIndex];
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

    if (moveData.category === 'Status' || !moveData.basePower) {
      return [{ choice: candidate.choice, score: STATUS_MOVE_SCORE }];
    }

    const attackerTypes = attacker ? this.dex.species.get(attacker.species).types : [];
    const stab = attackerTypes.includes(moveData.type) ? 1.5 : 1;

    if (FOE_TARGETABLE.has(candidate.move.target)) {
      const results: ScoredChoice[] = [];
      for (const foeIdx of [0, 1] as const) {
        if (this.foeFainted[foeIdx]) continue;
        const choice = `move ${candidate.move.slot} ${foeIdx + 1}${candidate.move.zMove ? ' zmove' : ''}`;
        const score = moveData.basePower * stab * this.effectivenessMultiplier(moveData.type, foeIdx);
        results.push({ choice, score });
      }
      if (results.length) return results;
      // No tracked live foe yet (shouldn't normally happen) - fall back to the default choice.
      return [{ choice: candidate.choice, score: moveData.basePower * stab }];
    }

    const liveFoe = this.foeFainted[0] ? (this.foeFainted[1] ? undefined : 1) : 0;
    const effectiveness = liveFoe === undefined ? 1 : this.effectivenessMultiplier(moveData.type, liveFoe);
    return [{ choice: candidate.choice, score: moveData.basePower * stab * effectiveness }];
  }

  private effectivenessMultiplier(moveType: string, foeIdx: 0 | 1): number {
    const species = this.foeSpecies[foeIdx];
    if (!species) return 1;
    const types = this.dex.species.get(species).types;
    if (!this.dex.getImmunity(moveType, types)) return 0;
    return 2 ** this.dex.getEffectiveness(moveType, types);
  }
}
