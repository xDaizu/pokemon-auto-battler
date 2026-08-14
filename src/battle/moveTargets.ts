import { Dex } from '@pkmn/sim';
import { FORMAT_ID } from '../roster/roster.js';
import type { BattleTurnLog, MoveTargetCategory } from '../../shared/apiTypes.js';

const dex = Dex.forFormat(FORMAT_ID);

/**
 * The raw `|move|` protocol line only ever names one nominal Pokémon target
 * (see `battle-actions.js`'s `addMove` call upstream in `@pkmn/sim`) - for a
 * spread move like Rock Slide that's just the target the engine happened to
 * pick for its spread-damage math, not "who actually got hit". The dex's
 * `target` field is the real answer (`allAdjacentFoes`, `self`, ...), so
 * this scans the finished log for every distinct move used and looks that
 * up once per move, keyed by move id the same way `esDex.json` is (see
 * `dexNames.ts`) so the frontend can join on it without re-slugging.
 */
export function collectMoveTargets(turns: BattleTurnLog[]): Record<string, MoveTargetCategory> {
  const out: Record<string, MoveTargetCategory> = {};
  for (const turn of turns) {
    for (const line of turn.lines) {
      const parts = line.split('|');
      if (parts[0] !== 'move') continue;
      const moveName = parts[2];
      if (!moveName) continue;
      const move = dex.moves.get(moveName);
      if (move.exists) out[move.id] = move.target;
    }
  }
  return out;
}
