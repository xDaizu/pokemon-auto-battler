# CLAUDE.md

## Docs

This file is the only one loaded automatically. The rest live in `docs/` and are
read on demand — open the one that matches the task, not all of them.

| Read | When |
|---|---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | **Before any non-trivial change.** Module graph, request flows, the AI layer and its decision telemetry, protocol-log handling, the frontend, persistence and accounts, and the numbered invariants that break silently. §13 is the deployment shape. |
| [docs/RELEASING.md](docs/RELEASING.md) | Shipping to production, or working out why a deploy failed. Preflight, migrations, the env the service needs, rollback, and the traps that have cost real time. |
| [docs/PROVISIONING.md](docs/PROVISIONING.md) | Only when rebuilding the infrastructure from scratch or changing the GCP / Turso / GitHub Actions setup. Not needed for ordinary work. |
| [docs/design/DESIGN.md](docs/design/DESIGN.md) | Working on UI visuals — layout, typography, color direction. |

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
- **Deployed and live** at `https://pokeprofessor.web.app/battler/` — Firebase
  Hosting for the SPA, Cloud Run (`pab-api`, `europe-west1`) for the API, Turso
  for the database. The custom domain `pokeprofessor.xyz` is not wired up yet.
  Pushing to `main` deploys, behind one approval.
- The session cookie **must** be named `__session`: Firebase Hosting strips every
  other incoming cookie before forwarding to Cloud Run. Renaming it breaks auth
  in production while looking fine in dev.

## Commands

```sh
npm run dev                    # API :3001 + frontend :5173
npm run simulate               # headless CLI battle, prints the log
npm test                       # backend, node:test via tsx
npm --prefix frontend run test # frontend, vitest
npm --prefix frontend run lint # oxlint
```
