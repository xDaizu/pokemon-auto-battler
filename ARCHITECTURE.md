# Architecture

Machine-oriented reference for agents working in this repo. Describes the
module graph, data contracts, and the invariants that are easy to break.
For how to run the project, see [README.md](README.md).

## 1. What this is

A Gen 9 **doubles** auto-battler built on [`@pkmn/sim`](https://github.com/pkmn/ps),
the real Pokémon Showdown simulator engine. The player builds a two-Pokémon,
level-13 team restricted to species obtainable in FireRed/LeafGreen before
Brock; both sides are then played by a heuristic AI and the battle runs to
completion with no human input. The frontend replays the resulting log.

There is **no persistence layer**. No database, no sessions, no auth. Every
request is stateless; a battle is computed synchronously and returned whole.

## 2. Two npm projects, one repo

| | Root (`/`) | `frontend/` |
|---|---|---|
| Role | Simulation engine + Express API | Vite + React UI |
| Runtime | Node, ESM, run via `tsx` (no build step) | Vite dev server / `vite build` |
| Module system | `NodeNext` — **relative imports must carry the `.js` extension** | bundler resolution, no extensions |
| Test runner | `node:test` via `tsx --test` | Vitest + Testing Library + jsdom |
| Lint | none | oxlint |
| TS | `strict` + `noUncheckedIndexedAccess` | `strict` |

They have **separate `package.json` and `package-lock.json`**. `npm install` at
the root does not install the frontend's dependencies; `npm run dev` uses
`concurrently` to run both, and `npm run client` shells out with `--prefix frontend`.

`noUncheckedIndexedAccess` is on at the root, which is why backend code is full
of `arr[i]!` and `?? fallback` around index reads. Preserve that style; do not
"clean up" the non-null assertions into unchecked reads.

## 3. Module graph

```mermaid
graph TD
  subgraph frontend["frontend/ (React)"]
    App[App.tsx<br/>screen state machine]
    Intro[IntroScreen]
    Builder[TeamBuilder]
    Battle[BattleScreen]
    Client[api/client.ts]
    FTypes[api/types.ts<br/>hand-mirrored DTOs]
    App --> Intro & Builder & Battle
    Builder --> Client
    Battle --> Client
    Client -.-> FTypes
  end

  subgraph server["src/server"]
    Express[index.ts<br/>Express :3001]
  end

  subgraph roster["src/roster"]
    Roster[roster.ts<br/>legal species + movepools]
    Build[buildTeam.ts<br/>validate to export text]
    Describe[describeTeam.ts<br/>export text to display DTO]
  end

  subgraph battle["src/battle"]
    Run[runBattle.ts<br/>stream wiring]
    Log[log.ts<br/>protocol to turns]
  end

  subgraph ai["src/ai"]
    Doubles[DoublesPlayerAI<br/>joint 2-slot search]
    Heur[HeuristicPlayerAI<br/>per-slot fallback]
    Dmg[damageHeuristic.ts]
    Cand[moveCandidates.ts]
    Doubles -->|extends| Heur
    Doubles --> Dmg & Cand
  end

  Client -->|"HTTP /api/*"| Express
  Express --> Roster & Build & Describe & Run
  Build --> Roster
  Describe --> Roster
  Run --> Doubles & Log
  Heur -->|extends| PS["@pkmn/sim RandomPlayerAI"]
  Roster & Build & Describe & Run --> Dex["@pkmn/sim Dex / Teams"]

  CLI[src/index.ts<br/>npm run simulate] --> Run
  CLI --> Configs[src/config/teams/*]
  Express --> Configs
```

`@pkmn/sim` is the single source of truth for all Pokémon data — species,
types, learnsets, type chart, damage mechanics. There is deliberately **no**
separate dex package and **no** hand-maintained stat/move tables. PokeAPI is
used only by the offline script in §8, never at runtime.

## 4. Request flows

### `GET /api/roster` — what the player may pick
`roster.ts` is the rules engine for legality. It starts from a hardcoded
`BASE_SPECIES` list of ten base species, then for each one:

1. `evoChainStageIds` walks the evolution line, keeping only stages reachable
   by **plain level-up evolution at or below `LEVEL_CAP` (13)**. No stones, no
   trades, no friendship — those items aren't obtainable pre-Brock.
2. `referenceGenForLine` picks the newest generation ≤ 9 that actually has
   level-up data for the line. Gen 9 is the target, but Pidgey, Rattata,
   Spearow, and the Caterpie/Weedle lines are absent from Paldea's dex and so
   have no gen-9 learnset; those fall back to gen 8. **This fallback is
   deliberate and test-covered** — do not hardcode `9`.
3. `legalMovesForStage` collects moves whose source matches `<gen>L<level>`
   with `level <= 13`, accumulating across *earlier* stages too (evolving never
   forgets moves). Only `L` (level-up) sources count — no egg, TM/HM, or tutor
   moves.

The result is memoised in `cachedRoster` for process lifetime. It is pure and
deterministic, so cache invalidation is a non-issue — but it also means
changing `BASE_SPECIES` or `LEVEL_CAP` requires a server restart.

`exclusiveGroup: 'starter'` on the Bulbasaur/Charmander/Squirtle lines encodes
"you can only ever own one starter." It is enforced in three places (server
validation, builder UI disabling, import parsing) and must stay consistent.

### `POST /api/battle` — the main path

```
TeamBuilder state          buildPlayerTeamConfig()        runBattle()
{stageId, moves[]}[2]  ->  validate + emit Showdown   ->  BattleStreams
                           export text (TeamConfig)       + 2x DoublesPlayerAI
                                                              |
BattleScreen replay    <-  {turns, winner, tie,        <-  collectOmniscientLog
                            player, rival}
```

Note the **export-text bottleneck**: the canonical interchange format between
team building and simulation is Pokémon Showdown export text (`TeamConfig
{label, exportText}`), not a structured object. `describeTeam` parses it *back*
into display DTOs rather than threading a parallel structure through. Keep it
that way — it's what lets a pasted Showdown team and a UI-built team take the
identical path.

### `POST /api/import-team` — pasted Showdown text
`parseImportedTeam` normalises names to IDs, rejects items and wrong levels,
then **calls `buildPlayerTeamConfig` for the real validation** rather than
duplicating rules. This is the reason the two entry points cannot drift on what
counts as legal. Preserve that delegation.

## 5. The AI layer

Two classes, one inheritance chain, both extending `@pkmn/sim`'s
`RandomPlayerAI` — which is reused (not `BattlePlayer` directly) for its
already-correct handling of disabled moves, forced switches, team preview, and
doubles choice-string formatting.

**`HeuristicPlayerAI`** — per-slot baseline. Scores each legal move/target as
`basePower × STAB × typeEffectiveness`, status moves at a constant `-1` so
they rank last but stay selectable. It also tracks opponent state
(`foeSpecies`, `foeFainted`, `foeHealth`) by **regex-parsing protocol lines** in
`receiveLine`, not by reading engine internals — the AI only ever knows what a
real client would.

**`DoublesPlayerAI`** — the one actually wired into `runBattle` for both sides.
It does a joint search over both active slots' move×target combinations
(`slotA.length × slotB.length`), which lets it focus-fire a KO neither slot
could get alone, value spread moves correctly (`×0.75`, matching the engine's
multi-target modifier), and treat `allAdjacent` friendly fire on its own ally
as a **cost** rather than a benefit. `finishingWeight` divides score by target
HP fraction as a proxy for "finish off the weakened one" — there is no real
damage calculator here, and it does not claim to predict actual damage.

`tryJointMove` returns `false` to **fall back to the inherited per-slot
heuristic** whenever the situation isn't a clean two-live-slot move turn:
forced switches, team preview, either side down to one mon, unrevealed foes.
Any thrown error also falls back. This fallback path is load-bearing — the
joint search is an optimisation over a correct baseline, not a replacement.

The whole layer is **pure arithmetic**: no battle cloning, no speculative
engine turns, no RNG consumed. It is deterministic and equally cheap for one
battle or a million.

### Known sharp edge: slot ↔ team-order coupling

Both AIs map an active slot to its Pokémon by **array position in `ownTeam`** —
`HeuristicPlayerAI.chooseMove` via a `moveCallIndex` counter incremented per
call, `DoublesPlayerAI` via `this.ownTeam.map(...)` indexed by slot. With a
fixed two-Pokémon team where both are active from turn one this is correct, but
it does not survive switches or larger teams. If team size ever exceeds 2,
resolve the attacker from the request's `side.pokemon` identity instead.

## 6. Protocol log handling

`collectOmniscientLog` consumes the **omniscient** stream (sees both sides) and
groups raw protocol lines into `{turn, lines[]}` buckets on `|turn|N`, stripping
only the leading `|`. Everything before turn 1 lands in a synthetic `turn: 0`
bucket. `|win|` and `|tie|` are captured *and* kept in the lines.

The log stays close to raw protocol on purpose — `@pkmn/protocol` is the
documented upgrade path for humanised text and is intentionally not installed.
Consequences downstream: `BattleScreen` re-parses those strings with its own
regexes (`^faint\|(p1|p2)[ab]: (.+)$`) for the faint indicators, and matches
`fainted` Pokémon by **display name**, and the winner by comparing
`result.winner` to `team.label`. Changing a `TeamConfig.label` therefore
silently changes win detection in the UI.

`turn: 0` also means `maxTurn = turns.length - 1` in `BattleScreen` counts
buckets, not game turns; the replay controls index buckets.

## 7. Frontend

`App.tsx` is a three-state screen machine (`intro → build → battle`) holding
the only cross-screen state: the chosen `PlayerPokemonSelection[]`. No router,
no state library, no context.

- **`TeamBuilder`** holds a fixed `[SlotState, SlotState]` tuple. Changing
  species resets stage and moves; changing stage resets moves. It re-implements
  the starter-exclusivity check client-side for immediate feedback and to
  disable buttons — the server check in `buildPlayerTeamConfig` remains
  authoritative.
- **`BattleScreen`** fetches the *entire* battle on mount, then reveals turn
  buckets on a 900 ms timer with pause / next / skip controls. The battle is
  already fully decided before the first line renders; the replay is pure
  presentation.
- **`api/types.ts` is a hand-maintained mirror** of the backend's `MoveOption`,
  `StageOption`, `RosterLine`, `TeamSummary`, `BattleResult`, and
  `PlayerPokemonSelection`. There is no shared package and no codegen. **Any
  change to a server response shape must be mirrored here manually** — the
  compiler will not catch a drift.
- Sprites come from the PokeAPI sprite CDN by national dex number
  (`spriteUrl`), the one runtime external dependency. It has no fallback; if
  the CDN is unreachable, images just fail to load.
- Vite dev-proxies `/api` to `:3001`, so the client uses same-origin relative
  paths and there is no CORS setup. A production deployment must reproduce that
  proxying — nothing in the code handles a cross-origin API.

## 8. Offline script

`scripts/pokemon-before-brock.ts` queries **PokeAPI** for every FireRed/LeafGreen
encounter reachable before the Pewter Gym (Routes 1/2/22, Viridian Forest, walk
encounters only — Surf and fishing come much later) plus the three starters. It
is **not wired into the runtime**; it is the audit trail justifying the
hardcoded `BASE_SPECIES` list in `roster.ts`. Its committed output lives at
`scripts/output/pokemon-before-brock.json`. Re-run it if the eligible-species
list is ever questioned, then update `BASE_SPECIES` by hand.

## 9. Invariants worth protecting

1. **`@pkmn/sim` is the only Pokémon data source at runtime.** Do not add a dex
   package or hand-written tables.
2. **`buildPlayerTeamConfig` is the single legality gate.** Both the structured
   and the pasted-text entry points must route through it.
3. **Backend relative imports end in `.js`** (`NodeNext`), even from `.ts`.
4. **Frontend DTOs must be updated in lockstep** with server response shapes.
5. **The AI reads only public protocol information.** Do not reach into engine
   internals for hidden movesets or exact HP.
6. **`DoublesPlayerAI` must always be able to fall back** to the inherited
   per-slot logic; keep `tryJointMove` total and non-throwing at the call site.
7. **`LEVEL_CAP` and `FORMAT_ID` are exported from `roster.ts`** and imported
   everywhere else. Never re-declare `13` or `'gen9doublescustomgame'` locally.

## 10. Testing

`npm test` runs `tsx --test src/**/*.test.ts` (33 tests) covering roster
generation, team validation/import, damage heuristics, move-candidate
derivation, and the doubles joint search. `npm --prefix frontend run test` runs
Vitest against `TeamBuilder` (3 tests). Both suites pass as of this document.

Coverage gaps to be aware of: `runBattle`, `collectOmniscientLog`, the Express
handlers, `BattleScreen`, and `describeTeam` have no direct tests.

The root test glob relies on shell expansion; because every test file sits
exactly one directory below `src/`, `src/**/*.test.ts` resolves correctly even
under a shell without `globstar`. A test placed at `src/foo.test.ts` or nested
two levels deep would be silently skipped.

## 11. Known duplication

- `src/config/teams/rival.ts` and `src/config/teams/fireRed/brock.ts` are
  **byte-identical** (both define Brock's team as `rivalTeam`). The CLI imports
  the former, the server the latter. README describes `rival.ts` as a separate
  CLI-only team, which no longer matches the file.
- `MoveCandidate` is declared twice — privately in `HeuristicPlayerAI.ts` and
  exported from `moveCandidates.ts`. `HeuristicPlayerAI` does not call
  `deriveMoveCandidates`; it receives candidates from `RandomPlayerAI`'s own
  filtering. `DoublesPlayerAI` uses the shared one.
- `src/config/teams/player.ts` is explicitly a **placeholder** with an
  unresearched moveset, used only by `npm run simulate`.
