# DEPLOYMENT.md

Plan for deploying this project to Google Cloud at
**`https://pokeprofessor.xyz/battler`** for **~$0/month**.

> **Status: not implemented.** Nothing in this document has been executed. No
> `Dockerfile`, `firebase.json`, or `.firebaserc` exists in the repo yet, and
> the code changes in §3 have not been made. This is the design and the runbook,
> written down so the work can be done deliberately later.

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
([src/server/index.ts:56](src/server/index.ts#L56)). A split-origin deployment —
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
  └─ /battler/api/**  → rewrite → Cloud Run `pab-api` (us-central1, scale-to-zero)
                                     │
                                     ▼
                                   Turso (libSQL over HTTPS)
```

Everything is one origin, so the `pab.sid` session cookie works exactly as it
does in dev under the Vite proxy.

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
[frontend/src/api/client.ts:91](frontend/src/api/client.ts#L91) hotlinks every
sprite from `raw.githubusercontent.com/PokeAPI/sprites` with **no fallback**, so
each page load carries a live third-party dependency that nothing in the deploy
controls or caches. Not a launch blocker — the app degrades to missing images
rather than breaking — but if a Content-Security-Policy is ever added, that
origin has to be allowed, and self-hosting the ~1,025 sprites alongside the SPA
would remove the dependency entirely for a few MB of Firebase Hosting storage.

---

## 3. Code changes this requires

None of these are done. Each is a trap that fails silently or late, which is why
they are written out with reasoning rather than as a checklist.

### 3.1 The backend cannot start in production today

[package.json](package.json) has no production start script. The only server
script is `"server": "tsx watch src/server/index.ts"` — watch mode, wrong for a
container. Worse, `tsx` is a **devDependency** while being required at runtime,
because the project deliberately has no build step (CLAUDE.md fast facts). So
`npm ci --omit=dev` produces an image that cannot boot, and it fails at container
start rather than at build time.

Needed:

- Add `"start": "tsx src/server/index.ts"`.
- Move `tsx` from `devDependencies` to `dependencies`. It carries its own
  esbuild; `typescript` is **not** needed at runtime, since tsx strips types
  without typechecking. This preserves the intentional no-build-step design
  rather than introducing a `tsc` output directory.
- Add `"engines": { "node": ">=24" }` to match `.github/workflows/ci.yml`. There
  is currently no `engines` field, no `.nvmrc`, and no `.node-version` anywhere —
  CI's `node-version: 24` is the only signal of the intended runtime.

### 3.2 Nothing supports a base path

Firebase Hosting rewrites forward the **full original path**, so Cloud Run
receives `/battler/api/roster`, not `/api/roster`. Both halves of the app assume
they live at the domain root.

**Server** — introduce a `BASE_PATH` env var defaulting to `''`:

```ts
const BASE_PATH = process.env.BASE_PATH ?? '';
```

Move every route registration in [src/server/index.ts](src/server/index.ts) from
`app.*` onto an `express.Router()`, then mount it with `app.use(BASE_PATH, api)`.

`express.json()`, `app.set('trust proxy', 1)`, and the `session(...)` middleware
stay **global on `app`** — the session cookie must keep path `/` so it is sent to
both the static origin and the API. The ordering invariant is unchanged:
`api.use(requireAuth)` still sits between the public routes
([src/server/index.ts:65-136](src/server/index.ts#L65-L136)) and the gated ones
([src/server/index.ts:140-279](src/server/index.ts#L140-L279)).

Making this an env var rather than a hardcoded `/battler` is deliberate — see §8.

**Frontend** — [frontend/vite.config.ts](frontend/vite.config.ts) currently sets
neither `base` nor `build.outDir`:

```ts
base: process.env.VITE_BASE ?? '/',
build: { outDir: '../hosting/battler', emptyOutDir: true },
```

With `VITE_BASE` unset, `base` stays `/` and dev is completely unchanged — the
existing `server.proxy['/api']` rule needs no edit. The production build sets
`VITE_BASE=/battler/`.

Emitting straight into `hosting/battler/` is what makes the Firebase layout work
with no copy step (see §4). Add `hosting/` to [.gitignore](.gitignore).

All nine `fetch` calls in [frontend/src/api/client.ts](frontend/src/api/client.ts)
hardcode `/api`. Derive the root from Vite's base instead:

```ts
const API = `${import.meta.env.BASE_URL}api`; // BASE_URL always ends in '/'
```

Then `fetch('/api/roster')` becomes `` fetch(`${API}/roster`) ``, and likewise for
`/rival`, `/battle`, `/import-team`, `/moves/:name`,
`/battles/:id/suggestions`, `/species`, `/auth/login`, `/auth/logout`, and
`/auth/me`. In dev this resolves to `/api/...` exactly as today. The app has no
router (it is a single page), so there is no other base-path surface.

Check `frontend/src` for tests asserting literal `/api/...` fetch URLs and update
them alongside.

### 3.3 `SESSION_SECRET` fails open

[src/server/index.ts:50](src/server/index.ts#L50) falls back silently to
`'insecure-development-secret'`. Nothing warns, nothing crashes — a production
deploy that forgets the variable would sign session cookies with a string that is
public in this repo. It should throw when `NODE_ENV === 'production'`.

---

## 4. Deployment artifacts

Reference contents. **None of these files exist yet.**

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
      { "source": "/battler/api/**", "run": { "serviceId": "pab-api", "region": "us-central1" } },
      { "source": "/battler/**", "destination": "/battler/index.html" }
    ],
    "redirects": [
      { "source": "/battler", "destination": "/battler/", "type": 301 },
      { "source": "/", "destination": "/battler/", "type": 302 }
    ]
  }
}
```

- **Rewrite order matters.** `/battler/api/**` must come first, or the SPA
  fallback swallows every API call and returns HTML where the client expects
  JSON.
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
`cloudbuild`, `artifactregistry`, `secretmanager`, and `firebasehosting` APIs.

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

```sh
gcloud run deploy pab-api --source . --region us-central1 \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=3 --concurrency=10 \
  --cpu=1 --memory=1Gi --cpu-boost --timeout=60 \
  --set-env-vars BASE_PATH=/battler,NODE_ENV=production,DATABASE_URL=libsql://<db>-<org>.turso.io \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,DATABASE_AUTH_TOKEN=DATABASE_AUTH_TOKEN:latest
```

Why these flags:

- `us-central1` — both a Firebase-Hosting-supported rewrite region and a cheap
  one. The supported set is `us-central1`, `us-east1`, `us-west1`,
  `europe-west1`, `asia-east1`.
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
| `BASE_PATH` | `--set-env-vars` (**new**, §3.2) | routes mount at `/`, so every API call 404s behind the rewrite |
| `DATABASE_URL` | `--set-env-vars` | non-null-asserted at [src/db/pool.ts:10](src/db/pool.ts#L10); client creation fails |
| `DATABASE_AUTH_TOKEN` | Secret Manager | `undefined` is correct for local `file:` mode, fatal for Turso |
| `SESSION_SECRET` | Secret Manager | **silently** falls back to a secret published in this repo — §3.3 makes this throw |
| `VITE_BASE` | build-time only, §5 step 5 | build emits root-relative asset paths; every asset 404s under `/battler/` |

These are every `process.env` read in the codebase plus the two new ones. There
is no `import.meta.env` / `VITE_*` usage in the frontend today.

---

## 7. Verification checklist

### Local, before any deploy

- [ ] `npm run dev` — nothing regressed at `localhost:5173`. Log in, run a
      battle, submit a move suggestion.
- [ ] `npm test` and `npm --prefix frontend run test` both pass.
- [ ] `BASE_PATH=/battler npm start`, then `curl localhost:3001/api/species`
      → **404** and `curl localhost:3001/battler/api/species` → **200**.
- [ ] `VITE_BASE=/battler/ npm --prefix frontend run build`, then
      `firebase emulators:start --only hosting`. Load
      `http://localhost:5000/battler/`; assets resolve under `/battler/assets/`
      and the network tab shows fetches to `/battler/api/*`.
- [ ] `docker build -t pab .` and
      `docker run -e PORT=8080 -e DATABASE_URL=... -p 8080:8080 pab` boots.
      This is where a `tsx`-still-in-devDependencies mistake surfaces.

### After deploy

- [ ] `curl https://pokeprofessor.xyz/battler/api/species` → 200 JSON. Proves the
      rewrite reaches Cloud Run **and** that `BASE_PATH` matches what Firebase
      forwards. If it 404s, Firebase stripped the prefix — set `BASE_PATH=`
      (see §8).
- [ ] Browser login sets a `Secure` `pab.sid` cookie that survives a reload. If
      the cookie never sets, `app.set('trust proxy', 1)`
      ([src/server/index.ts:44](src/server/index.ts#L44)) is one hop short —
      Firebase plus Cloud Run is two proxies; bump it to `2`.
- [ ] A full battle lands a row in Turso (`select count(*) from battles`). This
      also proves the deliberately swallowed error path at
      [src/server/index.ts:228](src/server/index.ts#L228) isn't quietly hiding a
      database failure.
- [ ] `https://pokeprofessor.xyz/` redirects to `/battler/`, and a hard reload of
      `/battler/` (not just client-side navigation) serves `index.html`.
- [ ] After a day, Cloud Run instance time sits at zero between sessions —
      confirming scale-to-zero, and therefore the $0 bill.

---

## 8. Open item

Firebase's public docs do not state explicitly whether a Hosting rewrite forwards
the full original path to Cloud Run or strips the matched prefix. The expectation
here is that it forwards — it is a proxy, not a mount point — which is why
`BASE_PATH=/battler` is set on the service.

Making it an env var rather than hardcoding the prefix means the fix is a
one-flag redeploy if that expectation is wrong. The first post-deploy `curl` in
§7 is the test that settles it.

---

## 9. Later: CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs tests and lint only —
no build, no deploy. A follow-up workflow on `main` could use Workload Identity
Federation to run `gcloud run deploy --source .` plus
`firebase deploy --only hosting`. Not required for the first launch; deploy by
hand until the setup is stable.
