CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,          -- lowercased/trimmed by app code
  display_name TEXT NOT NULL,
  -- Plaintext by design, not an oversight. The risk password hashing defends
  -- against is a *reused, meaningful* secret leaking; a 3-species ordered combo
  -- is not reused as a credential anywhere else and guards nothing of value.
  -- This is a login gate for a hobby project, not an authentication boundary.
  pokemon_1 TEXT NOT NULL,
  pokemon_2 TEXT NOT NULL,
  pokemon_3 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_label TEXT NOT NULL,
  rival_label TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('player','rival','tie')),
  player_team_key TEXT NOT NULL,          -- sorted, '+'-joined player species ids
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS battles_user_id_idx ON battles (user_id);
CREATE INDEX IF NOT EXISTS battles_user_id_outcome_idx ON battles (user_id, outcome);
CREATE INDEX IF NOT EXISTS battles_player_team_key_idx ON battles (player_team_key);

CREATE TABLE IF NOT EXISTS battle_pokemon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  -- Denormalized from battles.user_id so "which player uses which Pokemon most"
  -- is a GROUP BY on this table alone. NULL on rival rows (Brock isn't a player).
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('player','rival')),
  slot INTEGER NOT NULL CHECK (slot IN (0,1)),
  species TEXT NOT NULL,
  display_name TEXT NOT NULL,
  level INTEGER NOT NULL,
  ability TEXT,
  nature TEXT,
  moves TEXT NOT NULL,                    -- JSON-encoded string[]; SQLite has no array type
  fainted INTEGER NOT NULL DEFAULT 0 CHECK (fainted IN (0,1)), -- nor a boolean type
  UNIQUE (battle_id, side, slot)
);
CREATE INDEX IF NOT EXISTS battle_pokemon_battle_id_idx ON battle_pokemon (battle_id);
CREATE INDEX IF NOT EXISTS battle_pokemon_user_id_idx ON battle_pokemon (user_id);
CREATE INDEX IF NOT EXISTS battle_pokemon_species_idx ON battle_pokemon (species);
CREATE INDEX IF NOT EXISTS battle_pokemon_user_id_species_idx ON battle_pokemon (user_id, species);

CREATE TABLE IF NOT EXISTS session (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,                     -- JSON-encoded express-session data
  expire INTEGER NOT NULL                 -- unix ms
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
