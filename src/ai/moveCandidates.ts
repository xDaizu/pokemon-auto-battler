import type { AnyObject } from '@pkmn/sim';

export interface MoveCandidate {
  choice: string;
  move: { slot: number; move: string; target: string; zMove: boolean };
}

/**
 * Derives the legal move choices for one active slot from its request data,
 * mirroring the filtering @pkmn/sim's own RandomPlayerAI applies (disabled
 * moves, adjacentAlly moves when there's no living ally). Never opts into
 * Terastallize/Dynamax/Mega Evolution/Z-Move - declining them is always a
 * legal choice, and gen9 custom games only expose Terastallize in practice.
 */
export function deriveMoveCandidates(active: AnyObject, hasAlly: boolean): MoveCandidate[] {
  const legal = (active.moves as AnyObject[])
    .map((m, idx) => ({ slot: idx + 1, move: m.move as string, target: m.target as string, disabled: !!m.disabled }))
    .filter((m) => !m.disabled);

  const filtered = legal.filter((m) => m.target !== 'adjacentAlly' || hasAlly);
  const usable = filtered.length ? filtered : legal;

  return usable.map((m) => ({
    choice: `move ${m.slot}`,
    move: { slot: m.slot, move: m.move, target: m.target, zMove: false },
  }));
}
