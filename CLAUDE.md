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
- **Deployed and live** at `https://<your-firebase-project-id>.web.app/battler/` — Firebase
  Hosting for the SPA, Cloud Run (`pab-api`, `europe-west1`) for the API, Turso
  for the database. The custom domain `<custom-domain>` is not wired up yet.
  [RELEASING.md](RELEASING.md) is the runbook for shipping a change;
  [DEPLOYMENT.md](DEPLOYMENT.md) is the one-time provisioning story and the
  reasoning behind the architecture.
- The session cookie **must** be named `__session`: Firebase Hosting strips every
  other incoming cookie before forwarding to Cloud Run. Renaming it breaks auth
  in production while looking fine in dev.

## Copy / i18n

- All user-facing text, in every language, must be gender-neutral. In Spanish
  this means rephrasing around gendered nouns/adjectives rather than using
  slash forms (`Bienvenido/a`) — e.g. reach for a verb-first phrasing
  (`¡Te doy la bienvenida!`) or an epicene noun (`persona entrenadora`)
  instead of `Bienvenido`/`Entrenador`. Applies to `frontend/src/i18n/translations.ts`
  and any other copy added later.

## Commands

```sh
npm run dev                    # API :3001 + frontend :5173
npm run simulate               # headless CLI battle, prints the log
npm test                       # backend, node:test via tsx
npm --prefix frontend run test # frontend, vitest
npm --prefix frontend run lint # oxlint
```
