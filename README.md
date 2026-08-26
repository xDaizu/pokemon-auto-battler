# pokemon-auto-battler

Gen 9 double-battle simulator, built on [`@pkmn/sim`](https://github.com/pkmn/ps) (the real Pokémon Showdown simulator engine), with a web frontend for picking a FireRed/LeafGreen gym leader — Brock and Misty are playable today — building a team legal for that leader (species obtainable before their gym, at their own level cap and team size), and auto-battling it against their fixed team.

Battles are saved to a database and attributed to a trainer, who signs in with a username and three Pokemon instead of a password. Every move decision either AI makes is recorded alongside the battle, and players can report the ones they disagree with from the replay — the raw material for tuning the heuristics.

**Live** — the URL is kept out of this repo to avoid unsolicited crawler traffic; ask a maintainer.

## Run

```sh
npm install
cp .env.example .env   # defaults to a local file database; set SESSION_SECRET
npm run migrate        # creates ./local.db — nothing to install or start first
npm run dev            # API server (:3001) + web frontend (:5173) together
```

Or headless, CLI-only (no frontend, no database):

```sh
npm run simulate  # runs one battle between src/config/teams/player.ts and a leader's fixed team, prints the log
npm run simulate -- misty  # optional leader id argv; defaults to brock
npm test
```

The frontend has its own npm project and its own lockfile — `npm --prefix frontend run test` / `lint` / `build`.

### Database

One engine for both environments: **libSQL**. Local development is a plain `file:./local.db` (a normal SQLite file — `sqlite3 local.db` works on it), and production points the same client at a [Turso](https://turso.tech)-hosted `libsql://` URL. Switching between them is one env var; there is no separate local/production code path.

```sh
DATABASE_URL=file:./local.db                      # local
DATABASE_URL=libsql://<db>-<org>.turso.io         # production, plus DATABASE_AUTH_TOKEN
```

Schema changes are `.sql` files in `src/db/migrations/`, applied with `npm run migrate`. Re-running is safe.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module graph, request flows, and the invariants that are easy to break silently. **Read this before non-trivial changes.**
- [docs/RELEASING.md](docs/RELEASING.md) — how to ship a change to production.
- [docs/PROVISIONING.md](docs/PROVISIONING.md) — the one-time infrastructure setup, already done. Only needed to rebuild it.
- [docs/design/DESIGN.md](docs/design/DESIGN.md) — visual direction for the UI.

## Layout

- `shared/apiTypes.ts` — the single source of truth for `/api/*` request/response shapes, imported type-only by both `src/server` and `frontend/src/api/types.ts` so the two sides can't drift apart.
- `src/config/leaders/` — the registry of gym leaders (`index.ts`: `getLeader`, `listLeaders`, `DEFAULT_LEADER_ID`) and the `LeaderConfig`/`LeaderRules` shape (`types.ts`) each one is defined against — team size, level cap, base species pool, evolution items, ace index, thematic type. Brock and Misty are `available: true`; the rest are bare placeholders.
- `src/config/teams/` — team definitions (Pokemon Showdown export-text format). `fireRed/brock.ts` and `fireRed/misty.ts` are each leader's fixed team, referenced from their `LeaderConfig`; `player.ts` is a CLI-only placeholder team, also used by `npm run simulate`.
- `src/roster/roster.ts` — derives the frontend's selectable Pokemon pool per leader (every species obtainable in FireRed/LeafGreen before that leader's gym — see `scripts/pokemon-before-brock.ts` / `pokemon-before-misty.ts`) from `@pkmn/sim`'s own `Dex`: which evolution stages are reachable at or below that leader's level cap (plus any item-gated evolution their `evolutionItems` allows, e.g. Misty's Moon Stone), and which level-up moves are legal at that cap, including moves learned earlier in the evolution line. Also serves natures and single-move lookups.
- `src/roster/buildTeam.ts` — validates a player's selection against the chosen leader's rules (team size, move count, duplicate species, starter mutual-exclusivity, ability/nature and move legality) and builds the Showdown export text `runBattle` expects.
- `src/roster/describeTeam.ts` — parses a team's export text back into display data (species name/number/types) for the frontend.
- `src/roster/nationalDex.ts` — the full national dex, used only to populate the login screen's Pokemon pickers. Deliberately separate from `roster.ts`'s battle roster.
- `src/ai/DoublesPlayerAI.ts` — the move-selection AI wired into both sides of a battle. Searches both active slots jointly so it can focus-fire, value spread moves, and avoid hitting its own ally. Falls back to `HeuristicPlayerAI.ts`, the per-slot baseline, whenever the turn isn't a clean two-slot move turn. Both score moves by basePower × STAB × type-effectiveness (`damageHeuristic.ts`) and weigh status moves in the same units.
- `src/ai/decisionSnapshot.ts` — what each AI could see when it chose, plus the choice it made; emitted through an optional hook and stored so decisions can be re-scored against a future heuristic.
- `src/battle/runBattle.ts` — wires the two AI players into a `gen9doublescustomgame` battle stream and runs it to completion, returning a structured turn-by-turn log plus the decision telemetry.
- `src/battle/log.ts` — collects the battle stream into turns, and prints them to the console (used by `npm run simulate`).
- `src/battle/faints.ts` / `moveTargets.ts` — re-read the finished log for which Pokemon fainted, and for what each move actually targeted (the raw protocol line names only one nominal target, even for spread moves).
- `src/server/index.ts` — Express API: `/api/species` and `/api/auth/*` are public, and `/api/roster`, `/api/rival`, `/api/moves/:name`, `/api/import-team`, `/api/battle` and `/api/battles/:id/suggestions` require a logged-in trainer.
- `src/db/` — libSQL client, migrations, and the writes: `persistBattle.ts` stores each finished battle (both teams, the outcome, which Pokemon fainted, and every AI decision), `persistMoveSuggestion.ts` stores a player's report on one of those decisions.
- `src/auth/` — trainer accounts and sessions. The credential is a username plus three ordered Pokemon; see docs/ARCHITECTURE.md §12 for why there is no password.
- `frontend/` — Vite + React UI: login/register screen, a leader bar (Brock and Misty selectable, six locked `?` slots), intro screen, team builder (species → evolution stage → ability, nature, up to 4 moves, no items, starter mutual-exclusivity — team size and level cap follow the chosen leader), and a battle screen that steps through the turn log with a win/loss banner. English/Spanish throughout, with a per-gym-leader theme layer.

## Rules enforced by the team builder

- No held items, no usable items
- Exactly as many Pokemon as the chosen leader's team size (2 for Brock, 3 for Misty), and never the same Pokemon twice
- Only Pokemon obtainable in FireRed/LeafGreen before that leader's gym
- Starters (Bulbasaur/Charmander/Squirtle) are mutually exclusive
- Level cap follows the chosen leader (13 for Brock, 19 for Misty) — evolution stage and moveset must be legal at or below it
- Between 1 and 4 moves, no duplicates, all legal at the level cap

The same rules apply to a pasted Showdown team: the import path routes through the identical validator rather than reimplementing it.
