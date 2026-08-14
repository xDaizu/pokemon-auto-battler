-- Everything the "iterate on the AI" feedback loop needs: what the AI could
-- see when it chose each move (battle_decisions), and what a player thinks
-- it should have done instead (move_suggestions), reported from the battle
-- log UI.

-- One row per move decision either side's AI actually committed to
-- (src/ai/decisionSnapshot.ts's MoveDecisionSnapshot) - the public battle
-- state at that instant plus the legal moves considered and the choice made.
-- Written once per battle alongside battles/battle_pokemon, regardless of
-- whether anyone reports on it, so a decision can be re-scored against a
-- future heuristic even if it's never flagged.
CREATE TABLE IF NOT EXISTS battle_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('p1','p2')),
  slot TEXT NOT NULL CHECK (slot IN ('a','b')),
  weather TEXT,
  own TEXT NOT NULL,           -- JSON SlotPublicState[2]: this side's active pair
  foe TEXT NOT NULL,           -- JSON SlotPublicState[2]: the opposing active pair
  legal_moves TEXT NOT NULL,   -- JSON {move,target}[]: candidates considered for this slot
  chosen_choice TEXT NOT NULL, -- raw choice string submitted, e.g. "move 1 2"
  UNIQUE (battle_id, turn, side, slot)
);
CREATE INDEX IF NOT EXISTS battle_decisions_battle_id_idx ON battle_decisions (battle_id);

-- Player-submitted feedback on individual AI move decisions ("Onix used Rock
-- Tomb on Caterpie!"), collected to iterate on the heuristics in src/ai.
CREATE TABLE IF NOT EXISTS move_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- Resolved server-side at submit time by matching turn/side/slot (parsed
  -- from raw_line) against battle_decisions - null if no matching decision
  -- was recorded (e.g. the slot was locked into a multi-turn move and never
  -- actually called chooseMove/tryJointMove that turn).
  decision_id INTEGER REFERENCES battle_decisions(id) ON DELETE SET NULL,
  turn INTEGER NOT NULL,
  line_index INTEGER NOT NULL,     -- position within that turn's protocol lines
  raw_line TEXT NOT NULL,          -- the exact `move|...` protocol line being reported, for context
  suggestion TEXT NOT NULL,        -- what the player thinks should have happened instead
  reason TEXT NOT NULL,            -- why
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS move_suggestions_battle_id_idx ON move_suggestions (battle_id);
CREATE INDEX IF NOT EXISTS move_suggestions_user_id_idx ON move_suggestions (user_id);
CREATE INDEX IF NOT EXISTS move_suggestions_decision_id_idx ON move_suggestions (decision_id);
