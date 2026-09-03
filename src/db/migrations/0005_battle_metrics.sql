-- First stats built on top of the per-battle/per-Pokemon rows §12 of
-- docs/ARCHITECTURE.md calls out as existing for exactly this: a per-leader
-- leaderboard. Alive-count is already derivable from battle_pokemon.fainted,
-- so only turns taken and remaining-HP% need new columns. Nullable and
-- forward-only: existing rows stay NULL, and the leaderboard query excludes
-- them rather than showing partial data.
ALTER TABLE battles ADD COLUMN turns INTEGER;
ALTER TABLE battles ADD COLUMN player_hp_pct REAL;
ALTER TABLE battles ADD COLUMN rival_hp_pct REAL;
