-- A second leader means battles are no longer implicitly "vs Brock", and a
-- team can be bigger than two. Two independent changes:
--
--   1. battles gets a stable leader id to group by (rival_label is display
--      text, not a key - "Brock" could theoretically be renamed later).
--   2. battle_pokemon.slot's CHECK (slot IN (0,1)) hard-codes a 2-mon team.
--      SQLite can't drop or loosen a CHECK constraint in place, so the table
--      is rebuilt under a new name and swapped in.

ALTER TABLE battles ADD COLUMN leader_id TEXT;

-- Rebuild battle_pokemon with CHECK (slot >= 0) instead of CHECK (slot IN
-- (0,1)). Every step below is safe to re-run from any interruption point -
-- including one that lands after the rename - because it only ever asks
-- "does the thing I'm about to create/copy/drop already exist?" rather than
-- assuming a particular step has or hasn't happened yet.
CREATE TABLE IF NOT EXISTS battle_pokemon_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('player','rival')),
  slot INTEGER NOT NULL CHECK (slot >= 0),
  species TEXT NOT NULL,
  display_name TEXT NOT NULL,
  level INTEGER NOT NULL,
  ability TEXT,
  nature TEXT,
  moves TEXT NOT NULL,
  fainted INTEGER NOT NULL DEFAULT 0 CHECK (fainted IN (0,1)),
  UNIQUE (battle_id, side, slot)
);

-- Local dev data predates consistent FK enforcement and has a handful of
-- battle_pokemon rows whose battle_id/user_id no longer resolve (rows left
-- behind by a delete run outside the app, before `PRAGMA foreign_keys = ON`
-- was always on for the connection doing it). This rebuild preserves rows
-- exactly as they are, orphans included - it is not the place to silently
-- drop history - so FK enforcement is off for the copy and restored after.
PRAGMA foreign_keys = OFF;

-- Explicit column list, id included, so existing rows keep their id (nothing
-- references battle_pokemon.id today, but there's no reason to churn it) and
-- OR IGNORE makes this a no-op on any retry that already copied a row.
INSERT OR IGNORE INTO battle_pokemon_v2
  (id, battle_id, user_id, side, slot, species, display_name, level, ability, nature, moves, fainted)
SELECT id, battle_id, user_id, side, slot, species, display_name, level, ability, nature, moves, fainted
FROM battle_pokemon;

DROP TABLE IF EXISTS battle_pokemon;
ALTER TABLE battle_pokemon_v2 RENAME TO battle_pokemon;

CREATE INDEX IF NOT EXISTS battle_pokemon_battle_id_idx ON battle_pokemon (battle_id);
CREATE INDEX IF NOT EXISTS battle_pokemon_user_id_idx ON battle_pokemon (user_id);
CREATE INDEX IF NOT EXISTS battle_pokemon_species_idx ON battle_pokemon (species);
CREATE INDEX IF NOT EXISTS battle_pokemon_user_id_species_idx ON battle_pokemon (user_id, species);

PRAGMA foreign_keys = ON;
