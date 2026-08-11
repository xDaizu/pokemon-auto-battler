# pokemon-auto-battler

Gen 9 double-battle simulator, built on [`@pkmn/sim`](https://github.com/pkmn/ps) (the real Pokémon Showdown simulator engine), with a web frontend for building a level-13, two-Pokemon team and auto-battling it against Brock's fixed FireRed/LeafGreen team.

## Run

```sh
npm install
npm run dev       # API server (:3001) + web frontend (:5173) together
```

Or headless, CLI-only (no frontend):

```sh
npm run simulate  # runs one battle between src/config/teams/player.ts and fireRed/brock.ts, prints the log
npm test
```

## Layout

- `shared/apiTypes.ts` — the single source of truth for `/api/*` request/response shapes, imported type-only by both `src/server` and `frontend/src/api/types.ts` so the two sides can't drift apart.
- `src/config/teams/` — team definitions (Pokemon Showdown export-text format). `fireRed/brock.ts` is Brock's fixed team, used by both the frontend/API and `npm run simulate`; `player.ts` is a CLI-only placeholder team, also used by `npm run simulate`.
- `src/roster/roster.ts` — derives the frontend's selectable Pokemon pool (every species obtainable in FireRed/LeafGreen before beating Brock — see `scripts/pokemon-before-brock.ts`) from `@pkmn/sim`'s own `Dex`: which evolution stages are reachable by level 13, and which level-up moves are legal at level 13, including moves learned earlier in the evolution line.
- `src/roster/buildTeam.ts` — validates a player's two-Pokemon selection (team size, move count, starter mutual-exclusivity, move legality) and builds the Showdown export text `runBattle` expects.
- `src/roster/describeTeam.ts` — parses a team's export text back into display data (species name/number/types) for the frontend.
- `src/ai/HeuristicPlayerAI.ts` — move-selection AI used for both sides: scores each legal move/target by basePower × STAB × type-effectiveness (via `@pkmn/sim`'s own `Dex`), preferring damaging moves over status moves.
- `src/battle/runBattle.ts` — wires the two AI players into a `gen9doublescustomgame` battle stream and runs it to completion, returning a structured turn-by-turn log.
- `src/battle/log.ts` — collects the battle stream into turns, and prints them to the console (used by `npm run simulate`).
- `src/server/index.ts` — Express API (`/api/roster`, `/api/rival`, `/api/battle`) that the frontend calls.
- `frontend/` — Vite + React team-builder UI: intro screen, team builder (species → evolution stage → up to 4 moves, level cap 13, no items, starter mutual-exclusivity), and a battle screen that steps through the turn log with a win/loss banner.

## Rules enforced by the team builder

- No held items, no usable items
- Exactly 2 Pokemon
- Only Pokemon obtainable in FireRed/LeafGreen before Brock
- Starters (Bulbasaur/Charmander/Squirtle) are mutually exclusive
- Level cap 13 — evolution stage and moveset must be legal at or below that level
