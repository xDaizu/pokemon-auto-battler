import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './pool.js';

// Resolved from this module's own location, not process.cwd(), so `npm run
// migrate` works from anywhere in the repo.
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Unlike `CREATE ... IF NOT EXISTS`, SQLite has no `ADD COLUMN IF NOT EXISTS`
// - so a script that crashes right after adding a column but before the file
// is recorded as applied fails with "duplicate column name" on retry, even
// though every other statement in these files is written to tolerate that.
// Rather than push table-existence checks into every migration file, comment
// out an ADD COLUMN here if the column is already there, so migration authors
// can keep writing the plain statement and retries stay safe for free.
async function skipAppliedAddColumns(sql: string): Promise<string> {
  const pattern = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)[^;]*;/gi;
  let result = sql;
  for (const [statement, table, column] of sql.matchAll(pattern)) {
    const info = await db.execute(`PRAGMA table_info(${table})`);
    const alreadyExists = info.rows.some((row) => row.name === column);
    if (alreadyExists) {
      result = result.replace(statement, `-- skipped, already applied: ${statement}`);
    }
  }
  return result;
}

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
    const rawSql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // executeMultiple runs a raw multi-statement script — exactly what a schema
    // file is — but it is NOT wrapped in an implicit transaction. That's why
    // every migration uses `CREATE ... IF NOT EXISTS`: a crash partway through
    // a file leaves it unrecorded, and re-running simply resumes.
    const sql = await skipAppliedAddColumns(rawSql);
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
