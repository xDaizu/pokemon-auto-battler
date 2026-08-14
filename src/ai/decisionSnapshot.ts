/**
 * The public battle state one AI-controlled slot could see at the instant it
 * chose a move, plus the choice it made. Emitted by `HeuristicPlayerAI`
 * (single-slot fallback) and `DoublesPlayerAI` (joint two-slot search) via
 * the optional `onDecision` constructor hook, and persisted verbatim
 * (`src/db/persistBattle.ts` -> `battle_decisions`) so a move-suggestion
 * report can be traced back to exactly what the AI knew when it decided -
 * not just the outcome line in the log - which is what makes it possible to
 * later re-score the same situation with a tweaked heuristic and see whether
 * it would have chosen differently.
 *
 * Deliberately mirrors only *publicly revealed* information (see
 * ARCHITECTURE.md §5 invariant: "The AI reads only public protocol
 * information") - own HP/status/boosts are exact (read from the request),
 * foe fields are whatever has actually been revealed by protocol lines so
 * far, same as the AI itself sees.
 */
export interface SlotPublicState {
  /** Undefined for a foe slot that hasn't been revealed yet (shouldn't occur
   * for a slot a joint decision is being scored around, but can for the
   * per-slot fallback path). */
  species?: string;
  hp: number;
  maxhp: number;
  /** Status condition abbreviation (`par`, `brn`, ...), absent if none. */
  status?: string;
  fainted: boolean;
  /** Net boost stage per stat, e.g. `{ atk: 2, spe: -1 }`. Only stats that
   * have ever been boosted/unboosted this battle appear. */
  boosts: Record<string, number>;
}

export interface LegalMoveOption {
  /** `@pkmn/sim` move id. */
  move: string;
  /** `@pkmn/sim` `MoveTarget` id, e.g. `normal`, `allAdjacentFoes`. */
  target: string;
}

export interface MoveDecisionSnapshot {
  turn: number;
  side: 'p1' | 'p2';
  slot: 'a' | 'b';
  /** Current weather name (`Sand`, `RainDance`, ...), absent if clear. */
  weather?: string;
  /** This side's own active pair, slot-indexed (`own[0]` is always 'a'). */
  own: [SlotPublicState, SlotPublicState];
  /** The opposing side's active pair, slot-indexed the same way. */
  foe: [SlotPublicState, SlotPublicState];
  /** Every move+target combination that was legal for this slot to choose
   * from - the actual input the heuristic scored, not just the outcome. */
  legalMoves: LegalMoveOption[];
  /** The raw choice string that was submitted, e.g. `"move 1 2"`. */
  chosenChoice: string;
}

/**
 * Parses `@pkmn/sim`'s request-side `condition` string - `"77/100 par"`,
 * `"100/100"`, or `"0 fnt"` - into structured HP/status/fainted. Shared by
 * both AI classes so the format is only special-cased once.
 */
export function parseCondition(condition: string): { hp: number; maxhp: number; status?: string; fainted: boolean } {
  const fainted = /(?:^0(?:\s|$))|\bfnt\b/.test(condition);
  const hpMatch = /(\d+)\/(\d+)/.exec(condition);
  const statusMatch = /\s([a-z]{3})$/.exec(condition);
  const status = statusMatch && statusMatch[1] !== 'fnt' ? statusMatch[1] : undefined;
  return {
    hp: hpMatch ? Number(hpMatch[1]) : fainted ? 0 : 1,
    maxhp: hpMatch ? Number(hpMatch[2]) : 1,
    status,
    fainted,
  };
}
