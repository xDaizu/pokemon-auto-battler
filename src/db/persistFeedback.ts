import { db } from './pool.js';
import type { FeedbackRequest } from '../../shared/apiTypes.js';

export interface PersistFeedbackParams extends FeedbackRequest {
  userId: number;
}

/**
 * Writes one piece of player-authored general feedback, stored verbatim in
 * whatever language it was typed in (the same documented exception to
 * "everything stored is English or a dex id" as move_suggestions.suggestion/
 * .reason - see docs/ARCHITECTURE.md §12).
 */
export async function persistFeedback(params: PersistFeedbackParams): Promise<number> {
  const { userId, body } = params;
  const result = await db.execute({
    sql: `INSERT INTO feedback (user_id, body) VALUES (?, ?) RETURNING id`,
    args: [userId, body],
  });
  return Number(result.rows[0]!.id);
}
