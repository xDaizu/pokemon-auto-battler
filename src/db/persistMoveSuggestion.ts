import { db } from './pool.js';
import type { MoveSuggestionRequest } from '../../shared/apiTypes.js';

export interface PersistMoveSuggestionParams extends MoveSuggestionRequest {
  battleId: number;
  userId: number;
}

// Matches the side/slot out of a `move|p2a: Onix|Rock Tomb|p1a: Caterpie`
// style raw protocol line - the same shape `IDENT`/`Mon` parse client-side.
const MOVE_LINE = /^move\|(p[12])([ab]):/;

/**
 * Writes one player-submitted report on an AI move decision. `rawLine` is the
 * raw protocol line (`move|p2a: Onix|Rock Tomb|p1a: Caterpie`), already
 * English/dex-id text (see docs/ARCHITECTURE.md §12 invariant 8) - `suggestion`
 * and `reason` are free-text authored by the player and stored as typed,
 * whatever language the UI was in.
 *
 * Also resolves and stores the `battle_decisions` row this report is about,
 * if one was recorded: `rawLine` only names a side+slot, not a decision id,
 * so it's matched back by (battle, turn, side, slot). That row is what makes
 * the suggestion actionable later - it's the exact public state and legal
 * moves the AI was choosing from, not just the outcome line being reported.
 */
export async function persistMoveSuggestion(params: PersistMoveSuggestionParams): Promise<number> {
  const { battleId, userId, turn, lineIndex, rawLine, suggestion, reason } = params;

  const parsed = MOVE_LINE.exec(rawLine);
  let decisionId: number | null = null;
  if (parsed) {
    const [, side, slot] = parsed;
    const match = await db.execute({
      sql: `SELECT id FROM battle_decisions WHERE battle_id = ? AND turn = ? AND side = ? AND slot = ?`,
      args: [battleId, turn, side!, slot!],
    });
    decisionId = match.rows[0] ? Number(match.rows[0].id) : null;
  }

  const result = await db.execute({
    sql: `INSERT INTO move_suggestions (battle_id, user_id, decision_id, turn, line_index, raw_line, suggestion, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [battleId, userId, decisionId, turn, lineIndex, rawLine, suggestion, reason],
  });
  return Number(result.rows[0]!.id);
}
