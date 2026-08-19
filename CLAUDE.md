# CLAUDE.md

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before making non-trivial changes.**
It documents the module graph, the request flows, and the invariants that are
easy to break silently.

## Fast facts

- Two separate npm projects: root (Node + Express + `@pkmn/sim`, run via `tsx`,
  no build step) and `frontend/` (Vite + React 19). Separate lockfiles.
- Root TS is `NodeNext`: **relative imports must end in `.js`**, even from `.ts`.
- Root TS has `noUncheckedIndexedAccess`; the `arr[i]!` style is intentional.
- API DTOs live once in `shared/apiTypes.ts` (type-only, no runtime code).
  `frontend/src/api/types.ts` just re-exports from it. Add/change DTOs there,
  not in `src/server` or `frontend/src/api` directly.
- `@pkmn/sim` is the only runtime Pokémon data source. Don't add another dex.
- `LEVEL_CAP` (13) and `FORMAT_ID` (`gen9doublescustomgame`) are exported from
  `src/roster/roster.ts`. Import them; never re-declare the literals.
- [DEPLOYMENT.md](DEPLOYMENT.md) holds the (not yet implemented) GCP deployment
  plan for `pokeprofessor.xyz/battler`, including the base-path and production
  start-script changes the app still needs before it can run outside dev.

## Commands

```sh
npm run dev                    # API :3001 + frontend :5173
npm run simulate               # headless CLI battle, prints the log
npm test                       # backend, node:test via tsx
npm --prefix frontend run test # frontend, vitest
npm --prefix frontend run lint # oxlint
```
