import type { Row } from '@libsql/client';
import { db } from '../db/pool.js';

export interface UserRow {
  id: number;
  username: string;
  displayName: string;
  pokemon: [string, string, string];
}

function toUserRow(row: Row): UserRow {
  return {
    id: Number(row.id),
    username: row.username as string,
    displayName: row.display_name as string,
    pokemon: [row.pokemon_1 as string, row.pokemon_2 as string, row.pokemon_3 as string],
  };
}

export async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
  const row = result.rows[0];
  return row ? toUserRow(row) : undefined;
}

export async function findUserById(id: number): Promise<UserRow | undefined> {
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  const row = result.rows[0];
  return row ? toUserRow(row) : undefined;
}

export async function createUser(
  username: string,
  displayName: string,
  pokemon: [string, string, string]
): Promise<UserRow> {
  const result = await db.execute({
    sql: `INSERT INTO users (username, display_name, pokemon_1, pokemon_2, pokemon_3)
          VALUES (?, ?, ?, ?, ?) RETURNING *`,
    args: [username, displayName, ...pokemon],
  });
  return toUserRow(result.rows[0]!);
}

export async function updateDisplayName(id: number, displayName: string): Promise<void> {
  await db.execute({ sql: 'UPDATE users SET display_name = ? WHERE id = ?', args: [displayName, id] });
}
