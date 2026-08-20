# DEPLOYMENT.md

Plan for deploying this project to Google Cloud at
**`https://pokeprofessor.xyz/battler`** for **~$0/month**.

> **Status: the repo is deploy-ready; nothing is provisioned.** Every §3 code
> change is made and every §4 artifact exists. What has *not* happened is §5:
> there is no GCP project, no Turso database, no secret, and no DNS record, so
> nothing is running anywhere yet.
>
> Local development is deliberately untouched. `BASE_PATH` and `VITE_BASE` are
> both unset in dev, which is exactly the case that reproduces the old
> behaviour — `npm run dev` still serves the SPA at `/` and proxies `/api` to
> `:3001`, byte for byte as before.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — this document assumes its module
graph and, in several places, depends on invariants it documents.

---

## 1. Why this shape

Two constraints drive every decision below.

**Single-origin is mandatory, not a preference.** ARCHITECTURE.md §7 says it
outright: *"A production deployment must reproduce that proxying — nothing in the
code handles a cross-origin API."* The frontend uses bare relative paths
(`fetch('/api/roster')`), there is no CORS setup anywhere in `src/server`, and
the session cookie is `sameSite: 'lax'` with no credentialed-CORS handling
([src/server/index.ts:76](src/server/index.ts#L76)). A split-origin deployment —
static bucket plus a separate API host — would break authentication outright, not
merely inconvenience it.

**Path-based routing on a custom domain is normally expensive.** Serving one app
at `/battler` while the apex stays available for other things is a URL-map job,
which in GCP means a Global External HTTPS Load Balancer. The forwarding rule
alone is ~$18/month before a single request is served — that cost dominates
everything else here and rules the approach out.

**Firebase Hosting replaces the load balancer.** It does path-based rewrites to
Cloud Run for free, on a custom domain, with free managed SSL. That single
substitution is what makes the whole deployment land inside permanent free tiers.

Two smaller decisions, already settled:

- **Turso for the database, not Cloud SQL.** The app needs persistent libSQL —
  users, sessions, and battle history all live there. Cloud SQL costs ~$9-25/month
  minimum *and* would require rewriting every query to Postgres. Turso's free
  tier costs nothing and needs **zero code change**: `DATABASE_URL` /
  `DATABASE_AUTH_TOKEN` are already wired for it and
  [.env.example](.env.example) already documents the production URL form.
  SQLite on a GCS FUSE volume was considered and rejected — corruption risk with
  concurrent writers, and it would pin Cloud Run to `max-instances=1`.
- **Firebase Hosting CDN serves the SPA, not Cloud Run.** Cloud Run could serve
  the static build itself via `express.static`, which is one artifact instead of
  two. But then every page load pays a container cold start (~1-3s) and burns
  free-tier CPU seconds. Serving static from the CDN edge means the page loads
  instantly even when the API container is scaled to zero.

---

## 2. Traffic path

```
browser
  │
  ▼
pokeprofessor.xyz  ── Firebase Hosting (free managed SSL, CDN edge)
  ├─ /                → 302 → /battler/
  ├─ /battler/**      → hosting/battler/**            (static, served from CDN)
  └─ /battler/api/**  → rewrite → Cloud Run `pab-api` (europe-west1, scale-to-zero)
                                     │
                                     ▼
                                   Turso (libSQL over HTTPS)
```

Everything is one origin, so the session cookie works exactly as it does in dev
under the Vite proxy — **provided it is named `__session`**. Firebase Hosting
strips every other incoming cookie before forwarding a rewrite to Cloud Run, so
that name is load-bearing; see §5's note and
[src/server/index.ts:56](src/server/index.ts#L56).

### Cost

| Piece | Service | Cost |
|---|---|---|
| SPA static assets | Firebase Hosting CDN | free — 10 GB storage, 360 MB/day transfer |
| API | Cloud Run, `min-instances=0` | free — 2M requests, 180k vCPU-s, 360k GiB-s / mo |
| Image storage | Artifact Registry | ~$0.05/mo past the 0.5 GB free tier; a cleanup policy keeps it at $0 |
| Builds | Cloud Build | free — 2,500 build-minutes/mo |
| Database | Turso free tier | free — 5 GB, 500M row reads/mo |
| Secrets | Secret Manager | free — 6 active secret versions |
| DNS | registrar's own nameservers | free (Cloud DNS would add $0.20/zone/mo for nothing) |

Firebase→Cloud Run rewrites require **Blaze** (pay-as-you-go) billing rather than
the Spark plan, but every free-tier allotment above still applies on Blaze. A
hobby-traffic deployment should bill $0.00.

### Service inventory

**Two deploy targets, five GCP services, three outside vendors.**

*Things you actually deploy* — two artifacts, two commands:

| Artifact | Lands on | Command |
|---|---|---|
| API container image | Cloud Run (`pab-api`) | `gcloud run deploy --source .` |
| Static SPA bundle (`hosting/battler/`) | Firebase Hosting | `firebase deploy --only hosting` |

*GCP services used but never deployed to* — these engage automatically:

| Service | Role |
|---|---|
| Cloud Build | turns `--source .` into an image |
| Artifact Registry | stores that image — the one line item that can cost anything |
| Secret Manager | holds `SESSION_SECRET` and `DATABASE_AUTH_TOKEN` |

Firebase is **Google-owned, not a separate vendor** — on Blaze it bills to the
same Cloud Billing account as Cloud Run. The only separation is tooling: the
`firebase` CLI and console rather than `gcloud`.

Also worth naming for what it *isn't*: there is no Cloud DNS (registrar
nameservers instead) and no Load Balancer — Firebase Hosting doing the path
rewrite is precisely what replaces it, per §1.

*Third parties outside Google:*

| Vendor | Role | If it goes down |
|---|---|---|
| Turso (independent company) | the database — users, sessions, battle history | app unusable; login and battles both fail |
| the `.xyz` registrar | domain + DNS records for `pokeprofessor.xyz` | domain resolves nowhere |
| GitHub (Microsoft) | Pokémon sprite images, at runtime | sprites break; app still functions |

Only Turso is load-bearing among these, and it is the one with no viable GCP
substitute under ~$9/month.

**The GitHub dependency is not part of this deployment and is easy to miss.**
[frontend/src/api/client.ts:95](frontend/src/api/client.ts#L95) hotlinks every
sprite from `raw.githubusercontent.com/PokeAPI/sprites` with **no fallback**, so
each page load carries a live third-party dependency that nothing in the deploy
controls or caches. Not a launch blocker — the app degrades to missing images
rather than breaking — but if a Content-Security-Policy is ever added, that
origin has to be allowed, and self-hosting the ~1,025 sprites alongside the SPA
would remove the dependency entirely for a few MB of Firebase Hosting storage.

---

## 3. Code changes this requires

**All three are done.** Each is a trap that fails silently or late, so the
reasoning stays written out rather than collapsed into a changelog line.

### 3.1 The backend could not start in production ✅

[package.json](package.json) had no production start script. The only server
script was `"server": "tsx watch src/server/index.ts"` — watch mode, wrong for a
container. Worse, `tsx` was a **devDependency** while being required at runtime,
because the project deliberately has no build step (CLAUDE.md fast facts) — so
`npm ci --omit=dev` would have produced an image that cannot boot, failing at
container start rather than at build time.

Done, in [package.json](package.json):

- Added `"start": "tsx src/server/index.ts"`.
- Moved `tsx` from `devDependencies` to `dependencies`. It carries its own
  esbuild; `typescript` is **not** needed at runtime, since tsx strips types
  without typechecking. This preserves the intentional no-build-step design
  rather than introducing a `tsc` output directory.
- Added `"engines": { "node": ">=24" }` to match `.github/workflows/ci.yml`,
  which was previously the only signal of the intended runtime (there is still
  no `.nvmrc` or `.node-version`). Advisory only — npm's `engine-strict` is off
  and there is no `.npmrc`, so a Node 22 dev machine still installs and runs.

### 3.2 Base-path support ✅

Firebase Hosting rewrites forward the **full original path**, so Cloud Run
receives `/battler/api/roster`, not `/api/roster`. Both halves of the app assume
they live at the domain root.

**Server** — [src/server/index.ts](src/server/index.ts) now reads a `BASE_PATH`
env var defaulting to `''`:

```ts
const BASE_PATH = process.env.BASE_PATH ?? '';
```

All eleven route registrations moved from `app.*` onto an `express.Router()`
named `api`, mounted once at the bottom of the file with
`app.use(BASE_PATH || '/', api)` — the `|| '/'` is required because Express 5
rejects an empty mount path.

`express.json()`, `app.set('trust proxy', 1)`, and the `session(...)` middleware
stayed **global on `app`** — the session cookie must keep path `/` so it is sent to
both the static origin and the API. The ordering invariant is unchanged:
`api.use(requireAuth)` still sits between the public routes
([src/server/index.ts:91-162](src/server/index.ts#L91-L162)) and the gated ones
([src/server/index.ts:166-305](src/server/index.ts#L166-L305)).

Making this an env var rather than a hardcoded `/battler` is deliberate — see §8.

**Frontend** — [frontend/vite.config.ts](frontend/vite.config.ts) previously set
neither `base` nor `build.outDir`; it now sets both:

```ts
base: process.env.VITE_BASE ?? '/',
build: { outDir: '../hosting/battler', emptyOutDir: true },
```

With `VITE_BASE` unset, `base` stays `/` and dev is completely unchanged — the
existing `server.proxy['/api']` rule needs no edit. The production build sets
`VITE_BASE=/battler/`.

Emitting straight into `hosting/battler/` is what makes the Firebase layout work
with no copy step (see §4). `hosting/` is in [.gitignore](.gitignore). Note this
also moves the default build output off `frontend/dist/`.

All ten `fetch` calls in [frontend/src/api/client.ts](frontend/src/api/client.ts)
hardcoded `/api`. They now derive the root from Vite's base:

```ts
const API = `${import.meta.env.BASE_URL}api`; // BASE_URL always ends in '/'
```

So `fetch('/api/roster')` became `` fetch(`${API}/roster`) ``, and likewise for
`/rival`, `/battle`, `/import-team`, `/moves/:name`,
`/battles/:id/suggestions`, `/species`, `/auth/login`, `/auth/logout`, and
`/auth/me`. In dev this resolves to `/api/...` exactly as today. The app has no
router (it is a single page), so there is no other base-path surface.

No frontend test asserts a literal `/api/...` URL — the one suite that touches
the client (`frontend/src/screens/TeamBuilder.test.tsx`) mocks the module — so
nothing needed updating alongside.

### 3.3 `SESSION_SECRET` failed open ✅

The server used to fall back silently to `'insecure-development-secret'`. Nothing
warned, nothing crashed — a production deploy that forgot the variable would sign
session cookies with a string that is public in this repo. A
`resolveSessionSecret()` helper now throws when `NODE_ENV === 'production'` and
the variable is unset, so the container dies at boot rather than accepting forged
sessions.

---

## 4. Deployment artifacts

These all exist at the repo root now. Contents below, with the reasoning that
is not obvious from reading them.

### `Dockerfile`

Backend only — the SPA goes to Firebase, not into the image.

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY shared ./shared
COPY src ./src
ENV NODE_ENV=production
CMD ["npm", "start"]
```

Two constraints here are silent failures if broken:

- **`npm ci` must run inside the Linux image.** `@libsql/client` resolves a
  platform-specific native binding — on this Windows machine that is
  `@libsql/win32-x64-msvc`, via `libsql`'s optionalDependencies. Copying host
  `node_modules` into the image ships a Windows binary that cannot load. This is
  also why `.dockerignore` must exclude `node_modules`. `node:24-slim` is glibc;
  switching to Alpine requires the musl variant instead.
- **`shared/` must be copied.** [src/server/index.ts:30](src/server/index.ts#L30)
  imports `../../shared/apiTypes.js`. The migration `.sql` files ride along
  inside `src/`, which matters because `src/db/migrate.ts` reads them by path
  relative to its own module URL.

### `.dockerignore`

```
node_modules
frontend
hosting
.git
.github
.env
local.db*
*.md
```

### `firebase.json`

```json
{
  "hosting": {
    "public": "hosting",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/battler/api/**", "run": { "serviceId": "pab-api", "region": "europe-west1" } },
      { "source": "/battler/**", "destination": "/battler/index.html" }
    ],
    "redirects": [
      { "source": "/battler", "destination": "/battler/", "type": 301 },
      { "regex": "^/$", "destination": "/battler/", "type": 302 }
    ]
  }
}
```

- **Rewrite order matters.** `/battler/api/**` must come first, or the SPA
  fallback swallows every API call and returns HTML where the client expects
  JSON. Verified in the Hosting emulator (§7): the log shows the Cloud Run
  rewrite matching first, and `/battler/api/*` fails with a proxy error rather
  than quietly returning `index.html`.
- **The apex redirect uses `regex`, not `source`.** `{ "source": "/" }` — the
  obvious spelling, and what earlier drafts of this document specified — simply
  **never matches**: the emulator 404s the apex while `{ "source": "/battler" }`
  redirects fine, so it is the root path specifically that the glob matcher
  won't match. `{ "regex": "^/$" }` works. This is the sort of thing that would
  otherwise be found in production, on a domain, after DNS propagation.
- Firebase serves `hosting/` as the site root, so building into
  `hosting/battler/` (§3.2) puts `index.html` and `assets/` at exactly the paths
  `base: '/battler/'` generates — no copy step, no cross-platform shell script.
- The `/` redirect is safe only because the domain is otherwise unused. Drop it
  if a landing page is ever added at the apex.

### `.firebaserc`

```json
{ "projects": { "default": "pokeprofessor" } }
```

---

## 5. Provisioning runbook

One-time, manual. Steps 1-3 must complete before step 4.

### 1. Turso

Create the database and run migrations **from a laptop** — the server does *not*
migrate on boot. `src/db/migrate.ts` is a standalone script that `process.exit`s,
so this is a required separate step, not an afterthought:

```sh
DATABASE_URL=libsql://<db>-<org>.turso.io DATABASE_AUTH_TOKEN=<token> npm run migrate
```

### 2. GCP project

Project `pokeprofessor` with Blaze billing enabled. Enable the `run`,
`cloudbuild`, `artifactregistry`, `secretmanager`, and `firebasehosting` APIs —
**plus `firebase.googleapis.com`**, which this list originally missed. Hosting
needs it because `firebase projects:addfirebase` calls the Firebase Management
API, not the Hosting API.

Two traps here, both of which cost time on the real run:

- **Billing must be `open`, not merely have a valid card.** A closed billing
  account with a freshly updated payment method stays closed;
  `gcloud billing accounts list` reports `open: False` and the link fails.
  Reactivating is a separate action in the Console.
- **`projects:addfirebase` returns a bare `403 PERMISSION_DENIED`** even for a
  project Owner with every API enabled, when the Google account has never
  accepted the Firebase Terms of Service. The error names permissions and says
  nothing about terms. The fix is to add the project once through
  <https://console.firebase.google.com/> — pick the *existing* GCP project from
  the dropdown rather than creating a new one — and accept the terms. After
  that the CLI works normally.

### 3. Secrets

```sh
openssl rand -base64 48 | gcloud secrets create SESSION_SECRET --data-file=-
printf '%s' "$TURSO_TOKEN" | gcloud secrets create DATABASE_AUTH_TOKEN --data-file=-
```

Grant `roles/secretmanager.secretAccessor` to the Cloud Run runtime service
account. Two secrets sits inside the 6-active-version free tier.

### 4. Cloud Run

`--source .` uses Cloud Build and Artifact Registry automatically — no manual
image build or push.

Create the Artifact Registry repository first, so the deploy has no interactive
prompt to answer (it otherwise offers to create this itself, which is awkward in
a non-interactive shell and means accepting a prompt blind):

```sh
gcloud artifacts repositories create cloud-run-source-deploy   --repository-format=docker --location=europe-west1
```

```sh
gcloud run deploy pab-api --source . --region europe-west1 \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=3 --concurrency=10 \
  --cpu=1 --memory=1Gi --cpu-boost --timeout=60 \
  --set-env-vars BASE_PATH=/battler,NODE_ENV=production,DATABASE_URL=libsql://<db>-<org>.turso.io \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,DATABASE_AUTH_TOKEN=DATABASE_AUTH_TOKEN:latest
```

Why these flags:

- `europe-west1` — a Firebase-Hosting-supported rewrite region (the set is
  `us-central1`, `us-east1`, `us-west1`, `europe-west1`, `asia-east1`) in the
  same GCP pricing tier as `us-central1`, so it costs nothing extra. Europe
  over the US because that is where the players are: the app is fully
  Spanish-localized, and a transatlantic hop would otherwise be paid on every
  request. **Pair it with a Turso primary in AWS EU West (Ireland)** — the
  session store *is* the database
  ([src/auth/LibsqlSessionStore.ts](src/auth/LibsqlSessionStore.ts)), so every
  authenticated request makes a DB round-trip before doing anything else.
  Splitting the two across continents would put that latency on the critical
  path of every interaction.
- `--allow-unauthenticated` — required for Firebase Hosting rewrites to reach the
  service.
- `--min-instances=0` — the entire cost story. Idle costs nothing.
- `--concurrency=10` — `POST /api/battle` runs a full battle **synchronously**
  and blocks the event loop (ARCHITECTURE.md §5). High concurrency would just
  queue requests behind each other.
- `--memory=1Gi` — covers `@pkmn/sim` (46 MB on disk) plus the memoized
  1,025-species dex cache at
  [src/roster/nationalDex.ts:7](src/roster/nationalDex.ts#L7). At 1 GiB the free
  tier still covers ~100 hours of active instance time per month.
- `--cpu-boost` — mitigates the cold start that scale-to-zero implies.

Add an Artifact Registry cleanup policy (keep the 3 most recent images) to stay
under the 0.5 GB free allowance.

The server is safe to autoscale: no battle state is held in memory across
requests, and session state lives in the database, not in-process. The only
in-process state is read-only memoized dex derivation, which is pure — a cold
start cost, not a correctness concern.

### 5. Hosting

```sh
VITE_BASE=/battler/ npm --prefix frontend run build
firebase deploy --only hosting
```

**A redirect trap that only appears in production.** An earlier version of
`firebase.json` carried
`{ "source": "/battler", "destination": "/battler/", "type": 301 }` to add the
trailing slash. In production this puts the site's own homepage into an infinite
loop: Hosting normalizes the trailing slash *before* matching a redirect source,
so `/battler/` also matches `/battler` and is 301'd to itself — curl gives up
after 50 hops. The rule is unnecessary anyway, because Hosting already appends
the slash for a directory containing `index.html`. **The Hosting emulator does
not reproduce this** — it serves `/battler/` with a 200 — so this class of bug
survives local verification and has to be checked against the deployed site.

### 6. Domain

Add `pokeprofessor.xyz` (and `www`) as a custom domain in Firebase Hosting. At
the registrar, add the TXT verification record and the two A records Firebase
provides. **Keep the registrar's nameservers** — moving to Cloud DNS would add
$0.20/month for no benefit. Managed SSL provisions within ~24h.

---

## 6. Environment variables

| Variable | Where it comes from | If unset |
|---|---|---|
| `PORT` | injected by Cloud Run | defaults to `3001` ([src/server/index.ts:32](src/server/index.ts#L32)) |
| `NODE_ENV` | `ENV` in the Dockerfile | cookie `secure` flag stays off — cookies sent over plain HTTP |
| `BASE_PATH` | `--set-env-vars` (§3.2) | routes mount at `/`, so every API call 404s behind the rewrite |
| `DATABASE_URL` | `--set-env-vars` | non-null-asserted at [src/db/pool.ts:10](src/db/pool.ts#L10); client creation fails |
| `DATABASE_AUTH_TOKEN` | Secret Manager | `undefined` is correct for local `file:` mode, fatal for Turso |
| `SESSION_SECRET` | Secret Manager | throws at boot when `NODE_ENV=production` (§3.3); falls back to the dev default otherwise |
| `VITE_BASE` | build-time only, §5 step 5 | build emits root-relative asset paths; every asset 404s under `/battler/` |

These are every `process.env` read in the codebase. `VITE_BASE` is read in
`frontend/vite.config.ts` at build time only; the sole `import.meta.env` read in
app code is `BASE_URL` in `frontend/src/api/client.ts`, which Vite inlines as a
literal at build time.

---

## 7. Verification checklist

### Local, before any deploy

- [x] `npm run dev` — the dev server answers at `localhost:5173`, and `/api/*`
      still proxies to `:3001` (`/api/species` → 200, `/api/roster` → 401
      logged out). A manual pass through login → battle → move suggestion is
      still worth doing by hand.
- [x] `npm test` (79 pass) and `npm --prefix frontend run test` (3 pass), plus
      `npm --prefix frontend run lint` — only the three pre-existing
      `only-export-components` warnings.
- [x] `BASE_PATH=/battler npm start` → `/api/species` **404**,
      `/battler/api/species` **200**, `/battler/api/roster` **401** while logged
      out (so the router's `requireAuth` boundary survived the move). With
      `BASE_PATH` unset, `/api/species` is **200** again.
      *On Windows, run this from PowerShell, or prefix with `MSYS_NO_PATHCONV=1`
      — Git Bash rewrites any `/battler` argument into
      `C:/Program Files/Git/battler`, and Express then throws a confusing
      `path-to-regexp` error. This bites `docker run -e BASE_PATH=/battler` too.*
- [x] `NODE_ENV=production` with no `SESSION_SECRET` exits 1 at boot with
      `SESSION_SECRET must be set when NODE_ENV=production.` (§3.3).
- [x] `VITE_BASE=/battler/ npm --prefix frontend run build` emits into
      `hosting/battler/` with `index.html` referencing `/battler/assets/…` and
      the bundle inlining ``const API = `/battler/api` ``. Unset, the same build
      emits `/assets/…` and `/api`.
- [x] `firebase emulators:start --only hosting --project demo-pab` (CLI 15.27.0)
      against a `VITE_BASE=/battler/` build: `/` **302** → `/battler/` **200**,
      `/battler` **301** → `/battler/`, `/battler/deep/route` **200** serving
      `index.html` (SPA fallback), and `/battler/assets/…js` **200** as
      `application/javascript`. `/battler/api/species` fails with a proxy error
      — **not** HTML — and the emulator log reads `Cloud Run rewrite … triggered`,
      which is exactly the rewrite-order proof §4 asks for. It cannot go further
      locally: there is no `pab-api` service to reach yet.
      *This run is what caught the apex-redirect bug — see §4.*
- [x] `docker build -t pab .` then
      `docker run -e PORT=8080 -e DATABASE_URL=file:/app/local.db
      -e SESSION_SECRET=... -e BASE_PATH=/battler -p 8080:8080 pab` — boots on
      Node v24.19.0 and serves `/battler/api/species` **200**, `/api/species`
      **404**, `/battler/api/roster` **401**. This is the check that would have
      caught `tsx` left in `devDependencies`.
- [x] Inside that container, `npm run migrate` applied both migrations and
      `POST /battler/api/auth/login` returned **200** — so the `@libsql/client`
      native binding (§4) resolves correctly under Linux/glibc, which is the
      constraint no amount of testing on Windows can prove.
- [x] Same image with `SESSION_SECRET` omitted refuses to boot (`NODE_ENV=production`
      is baked in by the Dockerfile), and with `BASE_PATH` omitted it serves at
      the root again — both mount modes work from the one image.

### After deploy

- [x] `curl https://pokeprofessor.web.app/battler/api/species` → 200 JSON, so
      the rewrite reaches Cloud Run and `BASE_PATH=/battler` matches what
      Firebase forwards. §8 resolved: Hosting forwards the full path.
      (Re-run against `pokeprofessor.xyz` once §5 step 6 is done.)
- [x] Login sets a `Secure`, `HttpOnly` `__session` cookie and the session
      survives subsequent requests. Verified through Hosting: `POST /auth/login`
      200, then `GET /auth/me` returns the user and `GET /roster` 200.
      `trust proxy` = 1 proved sufficient across Firebase + Cloud Run — the
      cookie came back `secure`, so Express saw the original HTTPS scheme.

      **This is where the cookie name bit.** With the original `pab.sid`, login
      returned 200 and wrote a correct session row to Turso, but every later
      request 401'd, because Hosting drops any cookie not named `__session` on
      the way *in*. Diagnosed by running the same sequence against the Cloud Run
      URL directly (200) versus through Hosting (401).
- [x] A full battle lands a row in Turso. `POST /battle` returned 200 in 0.94s
      with `battleId: 1` — non-null, which is exactly what proves the swallowed
      error path at [src/server/index.ts:255](src/server/index.ts#L255) is not
      quietly hiding a database failure. Confirmed directly in the database:
      `battles` 1 row (`outcome=rival`, `player_team_key=caterpie+weedle`),
      `battle_pokemon` 4 rows (2 per side, correct levels),
      `battle_decisions` 11 rows, `move_suggestions` 1 row. The suggestion
      ownership check also holds: a battle id belonging to nobody returns 404.
- [x] `/` redirects to `/battler/` and a hard reload of `/battler/` serves
      `index.html` — verified on `pokeprofessor.web.app`: `/` 302 → `/battler/`
      (1 hop), `/battler` 301 → `/battler/` (1 hop, Hosting's own trailing
      slash), `/battler/` 200 (0 hops), `/battler/deep/route` 200 via the SPA
      fallback. Re-check on the custom domain after §5 step 6.
- [ ] After a day, Cloud Run instance time sits at zero between sessions —
      confirming scale-to-zero, and therefore the $0 bill.

---

## 8. Resolved: Firebase forwards the full path ✅

Firebase's public docs do not state explicitly whether a Hosting rewrite forwards
the full original path to Cloud Run or strips the matched prefix. The expectation
was that it forwards — it is a proxy, not a mount point — which is why
`BASE_PATH=/battler` is set on the service.

**Settled in production on 2026-08-20: it forwards.**
`GET https://pokeprofessor.web.app/battler/api/species` returns 200 with the
species JSON, which is only possible if Cloud Run received `/battler/api/species`
intact and matched it against the `BASE_PATH`-mounted router. Had Firebase
stripped the prefix, that request would have 404'd.

`BASE_PATH` stays an env var regardless — it is what makes this a one-flag
redeploy rather than a code change, and the same lever would move the app to a
different prefix later.

---

## 9. Later: CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs tests and lint only —
no build, no deploy. A follow-up workflow on `main` could use Workload Identity
Federation to run `gcloud run deploy --source .` plus
`firebase deploy --only hosting`. Not required for the first launch; deploy by
hand until the setup is stable.
