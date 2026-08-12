import { createClient, type Client } from '@libsql/client';

/**
 * The one libSQL client for the process. Local dev points DATABASE_URL at a
 * `file:` URL (a plain SQLite file, created on first migration); production
 * points it at a Turso-hosted `libsql://` URL. Same client, same SQL dialect,
 * both places — there is no per-environment compatibility layer.
 */
export const db: Client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN, // undefined is correct for local file mode
});

// SQLite/libSQL only enforces foreign keys when this pragma is set, and it is
// per-connection rather than stored in the schema. Defense-in-depth only:
// nothing here relies on ON DELETE CASCADE today (there are no delete routes).
void db.execute('PRAGMA foreign_keys = ON');
