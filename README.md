# pokemon-auto-battler

Gen 9 double-battle simulator, built on [`@pkmn/sim`](https://github.com/pkmn/ps) (the real Pokémon Showdown simulator engine), with a web frontend for building a level-13, two-Pokemon team and auto-battling it against Brock's fixed FireRed/LeafGreen team.

Battles are saved to a database and attributed to a trainer, who signs in with a username and three Pokemon instead of a password.

## Run

```sh
npm install
cp .env.example .env   # defaults to a local file database; set SESSION_SECRET
npm run migrate        # creates ./local.db — nothing to install or start first
npm run dev            # API server (:3001) + web frontend (:5173) together
```

Or headless, CLI-only (no frontend, no database):

```sh
npm run simulate  # runs one battle between src/config/teams/player.ts and fireRed/brock.ts, prints the log
npm test
```

### Database

One engine for both environments: **libSQL**. Local development is a plain `file:./local.db` (a normal SQLite file — `sqlite3 local.db` works on it), and production points the same client at a [Turso](https://turso.tech)-hosted `libsql://` URL. Switching between them is one env var; there is no separate local/production code path.

```sh
DATABASE_URL=file:./local.db                      # local
DATABASE_URL=libsql://<db>-<org>.turso.io         # production, plus DATABASE_AUTH_TOKEN
```

Schema changes are `.sql` files in `src/db/migrations/`, applied with `npm run migrate`. Re-running is safe.

## Layout

- `shared/apiTypes.ts` — the single source of truth for `/api/*` request/response shapes, imported type-only by both `src/server` and `frontend/src/api/types.ts` so the two sides can't drift apart.
- `src/config/teams/` — team definitions (Pokemon Showdown export-text format). `fireRed/brock.ts` is Brock's fixed team, used by both the frontend/API and `npm run simulate`; `player.ts` is a CLI-only placeholder team, also used by `npm run simulate`.
- `src/roster/roster.ts` — derives the frontend's selectable Pokemon pool (every species obtainable in FireRed/LeafGreen before beating Brock — see `scripts/pokemon-before-brock.ts`) from `@pkmn/sim`'s own `Dex`: which evolution stages are reachable by level 13, and which level-up moves are legal at level 13, including moves learned earlier in the evolution line.
- `src/roster/buildTeam.ts` — validates a player's two-Pokemon selection (team size, move count, starter mutual-exclusivity, move legality) and builds the Showdown export text `runBattle` expects.
- `src/roster/describeTeam.ts` — parses a team's export text back into display data (species name/number/types) for the frontend.
- `src/ai/HeuristicPlayerAI.ts` — move-selection AI used for both sides: scores each legal move/target by basePower × STAB × type-effectiveness (via `@pkmn/sim`'s own `Dex`), preferring damaging moves over status moves.
- `src/battle/runBattle.ts` — wires the two AI players into a `gen9doublescustomgame` battle stream and runs it to completion, returning a structured turn-by-turn log.
- `src/battle/log.ts` — collects the battle stream into turns, and prints them to the console (used by `npm run simulate`).
- `src/server/index.ts` — Express API (`/api/roster`, `/api/rival`, `/api/battle`, `/api/auth/*`, `/api/species`) that the frontend calls. Everything except the auth routes and `/api/species` requires a logged-in trainer.
- `src/db/` — libSQL client, migrations, and `persistBattle.ts`, which stores each finished battle (both teams, the outcome, and which Pokemon fainted).
- `src/auth/` — trainer accounts and sessions. The credential is a username plus three ordered Pokemon; see ARCHITECTURE.md §12 for why there is no password.
- `src/roster/nationalDex.ts` — the full national dex, used only to populate the login screen's Pokemon dropdowns. Deliberately separate from `roster.ts`'s battle roster.
- `frontend/` — Vite + React team-builder UI: login screen, intro screen, team builder (species → evolution stage → up to 4 moves, level cap 13, no items, starter mutual-exclusivity), and a battle screen that steps through the turn log with a win/loss banner.

## Rules enforced by the team builder

- No held items, no usable items
- Exactly 2 Pokemon
- Only Pokemon obtainable in FireRed/LeafGreen before Brock
- Starters (Bulbasaur/Charmander/Squirtle) are mutually exclusive
- Level cap 13 — evolution stage and moveset must be legal at or below that level
