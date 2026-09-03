import type { BattleTurnLog } from '../../shared/apiTypes.js';
import { parseCondition } from '../ai/decisionSnapshot.js';

// Same shape faints.ts uses to draw its raw-protocol regexes (see
// docs/ARCHITECTURE.md §6): the `condition` field ("hp/maxhp[ status]" or bare
// "0 fnt") is shared with `parseCondition`, which decisionSnapshot.ts already
// special-cases for exactly this format - reused here rather than reimplemented.
const SWITCH_LINE = /^switch\|(p1|p2)[ab]: ([^|]+)\|[^|]+\|([^|]+)/;
const HEALTH_LINE = /^-(?:damage|heal)\|(p1|p2)[ab]: ([^|]+)\|([^|]+)/;

export interface HpRemainingResult {
  p1Pct: number; // 0-100, sum(hp)/sum(maxhp) across the whole roster
  p2Pct: number;
}

type RosterHealth = Map<string, { hp: number; maxhp: number }>;

/**
 * Computes each side's total remaining HP as a percentage of its total
 * possible HP, across the whole roster (a fainted Pokemon contributes 0, not
 * an average over just the survivors) - see the leaderboard plan for why this
 * shape correlates with win margin better than a per-survivor average would.
 *
 * Walks `-damage`/`-heal`/`switch` lines, tracking the last-seen hp/maxhp per
 * display name per side (same identity convention `detectFaints` uses: p1/p2
 * map to player/rival unconditionally, since `runBattle` always builds p1
 * from `playerTeam` and p2 from `rivalTeam`).
 */
export function computeHpRemaining(turns: BattleTurnLog[]): HpRemainingResult {
  const p1: RosterHealth = new Map();
  const p2: RosterHealth = new Map();

  for (const turn of turns) {
    for (const line of turn.lines) {
      const switchMatch = SWITCH_LINE.exec(line);
      if (switchMatch) {
        applyCondition(switchMatch[1] === 'p1' ? p1 : p2, switchMatch[2]!, switchMatch[3]!);
        continue;
      }
      const healthMatch = HEALTH_LINE.exec(line);
      if (healthMatch) {
        applyCondition(healthMatch[1] === 'p1' ? p1 : p2, healthMatch[2]!, healthMatch[3]!);
      }
    }
  }

  return { p1Pct: sidePct(p1), p2Pct: sidePct(p2) };
}

/**
 * A lethal hit's condition reads bare "0 fnt", with no maxhp field -
 * `parseCondition` falls back to `maxhp: 1` for that shape (fine for its own
 * callers, which only need `fainted`/`hp`), but here that would corrupt the
 * roster's HP total. Keep the last known maxhp instead, mirroring
 * `HeuristicPlayerAI.updateFoeHealth`'s handling of the same bare-"0" case.
 */
function applyCondition(side: RosterHealth, name: string, condition: string): void {
  const parsed = parseCondition(condition);
  const maxhp = /\d+\/\d+/.test(condition) ? parsed.maxhp : (side.get(name)?.maxhp ?? parsed.maxhp);
  side.set(name, { hp: parsed.hp, maxhp });
}

function sidePct(side: RosterHealth): number {
  let hp = 0;
  let maxhp = 0;
  for (const entry of side.values()) {
    hp += entry.hp;
    maxhp += entry.maxhp;
  }
  return maxhp > 0 ? (hp / maxhp) * 100 : 0;
}
