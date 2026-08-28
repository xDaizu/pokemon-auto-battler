-- General player feedback, unrelated to any specific battle or AI decision
-- (contrast move_suggestions, which is scoped to one). Always from a
-- signed-in trainer - collected via the app footer's "leave feedback" CTA.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS feedback_user_id_idx ON feedback (user_id);
