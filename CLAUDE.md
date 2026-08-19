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
- The API mounts every route on one `express.Router()` at `BASE_PATH` (empty in
  dev, `/battler` in production). Add routes to that `api` router, not to `app`.
  The frontend mirrors it: `client.ts` builds URLs off
  `import.meta.env.BASE_URL`, set by `VITE_BASE` at build time. Both default to
  root, so dev is unaffected — but don't hardcode `/api` on either side.
- `npm --prefix frontend run build` emits into `hosting/battler/` (gitignored),
  not `frontend/dist/`.
- [DEPLOYMENT.md](DEPLOYMENT.md) holds the GCP deployment plan for
  `pokeprofessor.xyz/battler`. The code changes and artifacts (`Dockerfile`,
  `firebase.json`, `.firebaserc`) are done; nothing is provisioned yet.

## Commands

```sh
npm run dev                    # API :3001 + frontend :5173
npm run simulate               # headless CLI battle, prints the log
npm test                       # backend, node:test via tsx
npm --prefix frontend run test # frontend, vitest
npm --prefix frontend run lint # oxlint
```
