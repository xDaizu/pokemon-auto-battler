-- NPC accounts: trainers seeded by the app itself (e.g. the Brock leaderboard
-- fixtures, scripts/seed-brock-leaderboard.ts) rather than a real person
-- registering. Distinguishing them lets a future query exclude fixture data
-- from "real player" stats without deleting rows or guessing off username.
-- Nullable-and-forward-only in spirit even though it isn't nullable: every
-- existing row defaults to 'player', which is what it already was.
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'player' CHECK (account_type IN ('player','npc'));
CREATE INDEX IF NOT EXISTS users_account_type_idx ON users (account_type);
