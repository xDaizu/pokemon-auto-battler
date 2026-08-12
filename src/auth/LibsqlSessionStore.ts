import { Store, type SessionData } from 'express-session';
import { db } from '../db/pool.js';

/** Rows are pruned opportunistically on write rather than by a scheduled job;
 * at this app's write rate roughly one login in a hundred pays for the sweep. */
const PRUNE_CHANCE = 0.01;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function expiryFor(session: SessionData): number {
  return Date.now() + (session.cookie.maxAge ?? DEFAULT_TTL_MS);
}

/**
 * express-session store backed by the `session` table in 0001_init.sql.
 *
 * Written by hand because connect-pg-simple and friends are Postgres-only and
 * there is no maintained libSQL store. It is small enough that the alternative
 * — a second database purely for sessions — would cost more than it saves.
 *
 * `touch` matters more than it looks: `rolling: true` calls it on every
 * authenticated request to slide the expiry forward, which is what makes a
 * session effectively permanent without rewriting the whole blob each time.
 */
export class LibsqlSessionStore extends Store {
  override get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    void (async () => {
      try {
        const result = await db.execute({
          sql: 'SELECT sess, expire FROM session WHERE sid = ?',
          args: [sid],
        });
        const row = result.rows[0];
        if (!row || Number(row.expire) < Date.now()) {
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(row.sess as string) as SessionData);
      } catch (err) {
        callback(err);
      }
    })();
  }

  override set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        await db.execute({
          sql: `INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?)
                ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
          args: [sid, JSON.stringify(session), expiryFor(session)],
        });
        if (Math.random() < PRUNE_CHANCE) await this.pruneExpired();
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        await db.execute({ sql: 'DELETE FROM session WHERE sid = ?', args: [sid] });
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  override touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        await db.execute({
          sql: 'UPDATE session SET expire = ? WHERE sid = ?',
          args: [expiryFor(session), sid],
        });
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  private async pruneExpired(): Promise<void> {
    await db.execute({ sql: 'DELETE FROM session WHERE expire < ?', args: [Date.now()] });
  }
}
