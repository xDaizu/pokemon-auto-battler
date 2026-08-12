import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './pool.js';

// Resolved from this module's own location, not process.cwd(), so `npm run
// migrate` works from anywhere in the repo.
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main(): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  const appliedResult = await db.execute('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.filename as string));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    console.log(`Applying ${file}...`);
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // executeMultiple runs a raw multi-statement script — exactly what a schema
    // file is — but it is NOT wrapped in an implicit transaction. That's why
    // every migration uses `CREATE ... IF NOT EXISTS`: a crash partway through
    // a file leaves it unrecorded, and re-running simply resumes.
    await db.executeMultiple(sql);
    await db.execute({ sql: 'INSERT INTO schema_migrations (filename) VALUES (?)', args: [file] });
    ran++;
  }

  console.log(ran === 0 ? 'Already up to date.' : `Applied ${ran} migration(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
