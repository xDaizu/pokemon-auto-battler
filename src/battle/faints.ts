import type { BattleTurnLog } from '../../shared/apiTypes.js';

// Same shape BattleScreen.tsx uses to draw its faint indicators. The log stays
// close to raw protocol on purpose (see ARCHITECTURE.md §6), so both readers
// parse it rather than sharing a structured field.
const FAINT_LINE = /^faint\|(p1|p2)[ab]: (.+)$/;

export interface FaintResult {
  p1: Set<string>;
  p2: Set<string>;
}

/**
 * Collects the display names that fainted on each side of a finished battle.
 *
 * p1/p2 map to player/rival unconditionally: `runBattle` always builds p1 from
 * its `playerTeam` argument and p2 from `rivalTeam`. That's a stronger guarantee
 * than win/tie detection gets — `|win|` carries only a team label, which is why
 * the /api/battle handler has to compare `result.winner` against `team.label`.
 *
 * Matching is by display name, mirroring the frontend. `buildPlayerTeamConfig`
 * rejects duplicate species, so a player team can't have two Pokemon sharing a
 * name; rival team configs are hand-written and carry no such check, so a future
 * rival with a repeated species would mark both copies fainted together.
 */
export function detectFaints(turns: BattleTurnLog[]): FaintResult {
  const p1 = new Set<string>();
  const p2 = new Set<string>();

  for (const turn of turns) {
    for (const line of turn.lines) {
      const match = FAINT_LINE.exec(line);
      if (!match) continue;
      (match[1] === 'p1' ? p1 : p2).add(match[2]!);
    }
  }

  return { p1, p2 };
}
