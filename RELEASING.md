# RELEASING.md

How to ship a change to production. This is the **repeatable** runbook —
[DEPLOYMENT.md](DEPLOYMENT.md) is the one-time provisioning story and the
reasoning behind the architecture; read that when something here confuses you or
when you need to change *how* the deployment works rather than *what* is in it.

**Production**

| | |
|---|---|
| Site | `https://<project>.web.app/battler/` |
| API | `pab-api`, Cloud Run, `europe-west1` |
| GCP project | `pokeprofessor` |
| Database | Turso, AWS EU West (Ireland). URL lives in the gitignored `.env.prod`, deliberately not committed. |
| Secrets | `SESSION_SECRET`, `DATABASE_AUTH_TOKEN` in Secret Manager |

**Pushing to `main` deploys.** [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
runs §2 to §5 for you — see §4. Everything below is still the truth of what
happens, and is what you run by hand when CI is not an option; the workflow calls
the same scripts.

Run the manual commands from **PowerShell at the repo root**, unless a command
says otherwise.

---

## 1. What do I actually need to deploy?

The two halves ship independently. Deploy only what changed — but when in doubt,
deploying both is harmless. CI answers this question for you, from the diff of
the pushed range; this table is what it encodes.

| You changed | Migrate | Deploy API | Build + deploy Hosting |
|---|---|---|---|
| `src/**` (backend, AI, battle logic) | — | **yes** | — |
| `shared/apiTypes.ts` | — | **yes** | **yes** (types are compile-time, but the caller changed) |
| `frontend/**` | — | — | **yes** |
| `src/db/migrations/*.sql` | **yes, first** | **yes** | — |
| `firebase.json` (rewrites, redirects, headers) | — | — | **yes** (config only, but still rebuild — see §4) |
| `Dockerfile`, `package.json`, root deps | — | **yes** | — |
| `.md` files, tests only | — | — | — |

---

## 2. Preflight

CI runs all of this before it will deploy anything, so on the automated path
there is nothing to do here. Deploying by hand, never skip it: it is 30 seconds
and it is the only thing standing between you and a broken production site.

```powershell
npm test                        # backend, 79 tests
npm --prefix frontend run test  # frontend
npm --prefix frontend run lint  # 3 pre-existing warnings are expected
git status --short              # must be clean; commit before deploying
```

Deploy from a **committed tree**. `gcloud run deploy --source .` uploads your
working directory, not your last commit — so uncommitted experiments ship
silently, and you lose the ability to say which code is live.

---

## 3. Migrations (only if `src/db/migrations/` changed)

**Run migrations before deploying the API**, never after. For the brief window
between the two, the old code runs against the new schema — which is fine for
additive changes (new table, new nullable column) and broken for destructive ones
(dropped or renamed column). Write additive migrations, and this ordering is
always safe.

```powershell
.\scripts\migrate-prod.ps1
```

Expected: `Applying 00NN_xxx.sql...` then `Applied N migration(s).` Re-running is
safe and prints `Already up to date.` — every migration uses
`CREATE ... IF NOT EXISTS` because the runner is not transactional.

The script reads credentials from the gitignored `.env.prod`, refuses to run
against a `file:` URL, never prints the token, and clears the env vars in
`finally`. **Do not** use the `sh` syntax from DEPLOYMENT.md — PowerShell has no
inline env-var prefix, so `DATABASE_URL=... npm run migrate` silently runs
against your local `local.db` and reports success.

To run something else against production (a read-only query, a one-off script):

```powershell
.\scripts\migrate-prod.ps1 -Command 'node whatever.mjs'
```

---

## 4. Deploy

### Automatically, by pushing to `main`

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the tests and
lint, works out from the diff which of the three steps below are needed (the §1
table), then migrates, deploys the API, deploys Hosting, and runs §5's curl
checks — pausing once for your approval before it touches anything. It calls `scripts/deploy-api.ps1` — the same script you would — so
there is no second copy of the `gcloud run deploy` flag block to drift.

```sh
gh run watch                          # follow the deploy
gh workflow run deploy.yml -f targets=hosting -f run_migrations=false
```

| Job | Does | Approval |
|---|---|---|
| `test` | Calls `ci.yml` — the automated half of §2 | — |
| `plan` | Checks the variables, then reads the pushed diff to decide which halves to deploy — it encodes §1's table | — |
| `deploy` | §3 then §4: migrate, API, Hosting in that order, each step skipped when `plan` says it is not needed | **one click** |
| `verify` | §5's three curl checks | — |

**A deploy waits for you, once.** The `production` environment has a required
reviewer, so a run stops after the tests and before it touches GCP. Approve from
the run's summary page (or `gh run view <id> --web`) and the rest runs through.

Before approving, read the `plan` job's summary: it renders a table saying which
of migrate / API / Hosting this run will do, and it has already finished by the
time the prompt appears. That ordering is exactly why `plan` is a separate,
ungated job — and why the three deploy steps share one. They are strictly
sequential anyway, so splitting them across jobs would cost two more approvals
and buy only tidier logs.

The manual dispatch is for redeploying without a code change — after editing a
Secret Manager value, say, or when a previous run failed halfway.

Nothing sensitive lives in the workflow. It authenticates by Workload Identity
Federation, so there is no service-account key; `SESSION_SECRET` and
`DATABASE_AUTH_TOKEN` stay in Secret Manager and are never copied to GitHub. The
project id, region, service name, `BASE_PATH`, `VITE_BASE` and `SITE_URL` are
repository **variables**; the WIF provider, deployer service account and
`DATABASE_URL` are repository **secrets**. DEPLOYMENT.md §9 has the one-time
setup and the exact values.

If a run fails, the failing step is named after the section here that covers it.
Three failure modes worth knowing:

- **`plan` fails immediately.** A variable is missing or empty and the error
  names it. `VITE_BASE` without its trailing slash is rejected here rather than
  shipping a build whose assets all 404.
- **`deploy` fails in its first step.** A secret is missing. Failing just after,
  on the BOM or scheme guard, means the secret is present but mangled — §7.
- **`verify` fails but `deploy` was green.** The deploy landed; the site is
  misbehaving. §5 says what each check means, §7 what usually causes it, and §6
  rolls back.

Rollback stays manual — §6.

### By hand: API → Cloud Run

```powershell
.\scripts\deploy-api.ps1
.\scripts\deploy-api.ps1 -WhatIf   # print the exact command, deploy nothing
```

Takes 3–6 minutes; Cloud Build builds the image and pushes it to Artifact
Registry.

The script earns its place twice over. It reads `DATABASE_URL` from the
gitignored `.env.prod`, so the production database hostname is never committed.
And it always passes **the whole flag block** — `gcloud run deploy` *replaces*
the configuration it is given, so omitting `--set-secrets` on a later deploy
silently strips the secrets from the service, and the container then refuses to
boot because `SESSION_SECRET` is mandatory in production. Deploying by hand is
precisely how that mistake happens. `-WhatIf` prints the full command if you need
to see or adapt it.

`.dockerignore` keeps `node_modules`, `frontend/`, `.env*` and `local.db*` out of
the upload, so your credentials never leave the machine. Note that the `.env*`
pattern has to be a glob: `.dockerignore` matches whole path components, not
prefixes, so a bare `.env` line excludes only `.env` and would leave `.env.prod`
— which holds a read-write database token — in the tarball Cloud Build stages
in GCS.

### By hand: Frontend → Firebase Hosting

```powershell
$env:VITE_BASE='/battler/'; npm --prefix frontend run build; $env:VITE_BASE=$null
firebase deploy --only hosting --project pokeprofessor
```

⚠️ **Always rebuild before deploying Hosting, even when only `firebase.json`
changed.** `hosting/` is gitignored build output. If it is stale you will
silently publish an old bundle; if it is missing the deploy fails. Rebuilding is
under a second.

⚠️ **`VITE_BASE=/battler/` is mandatory** — with the trailing slash. Without it
the build emits root-relative asset paths and every asset 404s under `/battler/`.
The trailing `$null` stops a later `npm run dev` from inheriting it.

---

## 5. Verify

The `verify` job runs the three curl checks after every automated deploy. Run
them yourself after a manual one, from Git Bash or any shell with `curl`:

```sh
B=https://<project>.web.app          # or the custom domain once it resolves
curl -s -o /dev/null -w '%{http_code}\n' "$B/battler/api/species"     # 200
curl -s -o /dev/null -w '%{http_code}\n' "$B/battler/api/roster"      # 401 logged out
curl -s -L -o /dev/null -w '%{http_code} %{num_redirects}\n' "$B/"    # 200, 1 hop
```

Then load `/battler/` in a browser and log in — this part CI cannot do for you,
and it is worth doing by hand after anything touching sessions, cookies or
`firebase.json`. The single most valuable check is **log in, then reload the
page** — if you are still logged in,
the session cookie survived the round trip through Hosting, which is the
integration that has broken before (§7).

Check the logs if anything looks wrong:

```powershell
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=pab-api AND severity>=ERROR' --project=pokeprofessor --limit=20 --freshness=1h
```

---

## 6. Rollback

### API

Cloud Run keeps every revision. Roll back by shifting traffic — no rebuild, takes
seconds:

```powershell
gcloud run revisions list --service=pab-api --region=europe-west1 --project=pokeprofessor
gcloud run services update-traffic pab-api --region=europe-west1 --project=pokeprofessor `
  --to-revisions=pab-api-00001-b6c=100
```

The Artifact Registry cleanup policy keeps the 3 most recent images, so you can
always roll back at least two deploys.

### Hosting

```powershell
firebase hosting:rollback --project pokeprofessor
```

Or pick a specific release in the Firebase console under Hosting → Release
history.

### Database

**There is no rollback.** Migrations are forward-only and there are no down
scripts. To undo a schema change, write a new migration. This is why additive
migrations matter.

---

## 7. Things that will bite you

Each of these cost real time during the initial deployment. They are recorded
here so they cost nothing next time.

**The session cookie must stay named `__session`.** Firebase Hosting strips every
other incoming cookie before forwarding to Cloud Run. Rename it and login appears
to work — 200, correct session row in Turso — but every subsequent request 401s,
because the cookie is dropped on the way *in*. See
[src/server/index.ts:56](src/server/index.ts#L56).

**`BASE_PATH=/battler` must stay set on the service.** Hosting forwards the full
original path, so the API answers on `/battler/api/*`. Drop the env var and every
API call 404s.

**The Hosting emulator does not match production.** It served `/battler/` with a
200 while production was in an infinite redirect loop, because the emulator does
not reproduce Hosting's trailing-slash normalization. Treat emulator success as
weak evidence; verify against the deployed site.

**Git Bash mangles `/battler`.** MSYS rewrites any argument that looks like a
path, turning `/battler` into `C:/Program Files/Git/battler` — which surfaces as
a baffling `path-to-regexp` error from Express. Use PowerShell, or prefix with
`MSYS_NO_PATHCONV=1`. This hits `BASE_PATH=/battler npm start` and
`docker run -e BASE_PATH=/battler` alike.

**Windows PowerShell puts a BOM in front of anything you pipe into a native
command.** `$value | gh secret set NAME` stores the secret with an invisible
`EF BB BF` on the front, and nothing downstream tells you: `gh secret list` shows
the name, the deploy authenticates fine, the image builds, and only the container
fails — `LibsqlError: URL_INVALID: The URL '?libsql://...' is not in a valid
format`. That `?` is the BOM. Cloud Run then holds traffic on the previous
revision, so the site stays up and the breakage is invisible from outside.

Set secrets from **Git Bash**, not PowerShell:

```sh
printf '%s' "$(sed -n 's/^DATABASE_URL=//p' .env.prod)" | gh secret set DATABASE_URL
```

Or pass `--body` from either shell — it is an argument, not a stream, so it is
unaffected. This is also why the deploy workflow strips a leading `﻿` from
`DATABASE_URL` and `scripts/deploy-api.ps1` refuses a URL whose host will not
parse: the guard turns a 90-second build and a dead revision into an instant,
named error.

**Never commit secrets.** `.env.prod` holds a read-write database token. It is
gitignored, but stage files by name rather than `git add -A`, and check before
committing:

```sh
git diff --cached | grep -in "eyJhbGciOi\|_TOKEN=\|_SECRET="
git diff --cached --name-only | grep '\.env'
```

Both must come back empty.

---

## 8. Occasional maintenance

### Rotate the database token

```powershell
$env:TURSO_TOKEN = '<new-token>'
$env:TURSO_TOKEN | gcloud secrets versions add DATABASE_AUTH_TOKEN --data-file=- --project=pokeprofessor
gcloud secrets versions disable <old-version> --secret=DATABASE_AUTH_TOKEN --project=pokeprofessor
$env:TURSO_TOKEN = $null
```

Cloud Run resolves `:latest` at **instance startup**, so new instances pick it up
automatically and warm ones keep the old value until recycled. Force it
immediately with
`gcloud run services update pab-api --region=europe-west1 --project=pokeprofessor`.

Use a **non-expiring** token. A token with an expiry produces a delayed, silent
outage: the service stays healthy, pages load from the CDN, and only the database
calls fail — with no deploy that day to correlate against.

Also update `.env.prod` so `migrate-prod.ps1` keeps working.

### Watch the bill

It should be €0.00. Free tiers cover Cloud Run (`min-instances=0` idles at zero
cost), Hosting, Secret Manager, Cloud Build and Turso. The only line item that can
drift is Artifact Registry past 0.5 GB, which the cleanup policy handles.

```powershell
gcloud billing projects describe pokeprofessor
```

A €1 budget alert in the Console is a cheap safety net.

---

## 9. Still outstanding

**Custom domain.** The `.xyz` domain is bought but not wired up — production is
currently only on the default `web.app` address. See DEPLOYMENT.md §5 step 6: add the
domain in the Firebase console, add the TXT and A records at the registrar, keep
the registrar's nameservers, and expect ~24h for managed SSL. Once it resolves,
re-run §5's checks against the real domain.

**Pin `firebase-tools`?** The Hosting step runs `npx --yes firebase-tools`, which
takes whatever is current, so a bad release upstream becomes a failed deploy.
Local is on 15.27.0 if you want a version to pin to.

**Bump `actions/setup-node`.** Both workflows use `@v4`, which now emits a
Node-20 deprecation warning on every run. Harmless, but noisy.

CI/CD itself is done — provisioned, and §4 describes it. DEPLOYMENT.md §9 has
the setup, should any of it ever need rebuilding.
