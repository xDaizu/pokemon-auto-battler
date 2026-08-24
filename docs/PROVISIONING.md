# PROVISIONING.md

One-time setup, **already done** — production has been live since August 2026.
Nothing here needs running again unless you are rebuilding the infrastructure
from scratch, forking the project, or moving it to a different GCP project.

To *ship a change*, you want [RELEASING.md](RELEASING.md). For *why* the
deployment has this shape at all — why Firebase Hosting instead of a load
balancer, why Turso instead of Cloud SQL — see
[ARCHITECTURE.md §13](ARCHITECTURE.md).

The traps recorded below each cost real time on the original run. They are kept
because none of them is discoverable from the error you actually get.

---

## 1. What exists

| Piece | Identity |
|---|---|
| GCP project | `<gcp-project-id>`, Blaze billing |
| API | Cloud Run `pab-api`, `europe-west1` |
| SPA | Firebase Hosting, same project |
| Database | Turso, AWS EU West (Ireland) |
| Secrets | `SESSION_SECRET`, `DATABASE_AUTH_TOKEN` in Secret Manager |
| CI identity | Workload Identity Federation pool `github`, provider `repo`, SA `github-deployer@` |

Steps 2-4 must complete before step 5.

---

## 2. Turso

Create the database, then run migrations **from a laptop** — the server does
*not* migrate on boot. `src/db/migrate.ts` is a standalone script that
`process.exit`s, so this is a required separate step, not an afterthought.

```sh
DATABASE_URL=libsql://<db>-<org>.turso.io DATABASE_AUTH_TOKEN=<token> npm run migrate
```

Put the primary in **AWS EU West (Ireland)**, to match the Cloud Run region.
The session store *is* the database ([src/auth/LibsqlSessionStore.ts](../src/auth/LibsqlSessionStore.ts)),
so every authenticated request makes a DB round-trip before doing anything
else; splitting the two across continents puts that latency on the critical
path of every interaction.

Use a **non-expiring** token. One with an expiry produces a delayed, silent
outage: the service stays healthy, pages load from the CDN, and only database
calls fail — with no deploy that day to correlate against.

## 3. GCP project

Project `<gcp-project-id>` with Blaze billing. Enable the `run`, `cloudbuild`,
`artifactregistry`, `secretmanager`, and `firebasehosting` APIs — **plus
`firebase.googleapis.com`**, which is easy to miss. Hosting needs it because
`firebase projects:addfirebase` calls the Firebase Management API, not the
Hosting API.

Two traps, both of which cost time on the real run:

- **Billing must be `open`, not merely have a valid card.** A closed billing
  account with a freshly updated payment method stays closed;
  `gcloud billing accounts list` reports `open: False` and the link fails.
  Reactivating is a separate action in the Console.
- **`projects:addfirebase` returns a bare `403 PERMISSION_DENIED`** even for a
  project Owner with every API enabled, when the Google account has never
  accepted the Firebase Terms of Service. The error names permissions and says
  nothing about terms. Fix: add the project once through
  <https://console.firebase.google.com/> — picking the *existing* GCP project
  from the dropdown rather than creating a new one — and accept the terms.
  After that the CLI works normally.

## 4. Secrets

```sh
openssl rand -base64 48 | gcloud secrets create SESSION_SECRET --data-file=-
printf '%s' "$TURSO_TOKEN" | gcloud secrets create DATABASE_AUTH_TOKEN --data-file=-
```

Grant `roles/secretmanager.secretAccessor` to the Cloud Run runtime service
account. Two secrets sits inside the 6-active-version free tier.

## 5. Cloud Run

Create the Artifact Registry repository first, so the deploy has no interactive
prompt to answer — it otherwise offers to create this itself, which is awkward
in a non-interactive shell and means accepting a prompt blind:

```sh
gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker --location=europe-west1
```

```sh
gcloud run deploy pab-api --source . --region europe-west1 \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=3 --concurrency=10 \
  --cpu=1 --memory=1Gi --cpu-boost --timeout=60 \
  --set-env-vars BASE_PATH=/battler,NODE_ENV=production,DATABASE_URL=libsql://<db>-<org>.turso.io \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,DATABASE_AUTH_TOKEN=DATABASE_AUTH_TOKEN:latest
```

`--source .` uses Cloud Build and Artifact Registry automatically — no manual
image build or push. Thereafter use [scripts/deploy-api.ps1](../scripts/deploy-api.ps1),
which always passes the whole flag block; see RELEASING.md §4 for why that
matters.

Why these flags:

- `europe-west1` — a Firebase-Hosting-supported rewrite region (the set is
  `us-central1`, `us-east1`, `us-west1`, `europe-west1`, `asia-east1`) in the
  same GCP pricing tier as `us-central1`, so it costs nothing extra. Europe
  over the US because that is where the players are: the app is fully
  Spanish-localized, and a transatlantic hop would otherwise be paid on every
  request. Pair it with the Turso region from §2.
- `--allow-unauthenticated` — required for Firebase Hosting rewrites to reach
  the service.
- `--min-instances=0` — the entire cost story. Idle costs nothing.
- `--concurrency=10` — `POST /api/battle` runs a full battle **synchronously**
  and blocks the event loop. High concurrency would just queue requests behind
  each other.
- `--memory=1Gi` — covers `@pkmn/sim` (46 MB on disk) plus the memoized
  1,025-species dex cache in [src/roster/nationalDex.ts](../src/roster/nationalDex.ts).
  At 1 GiB the free tier still covers ~100 hours of active instance time/month.
- `--cpu-boost` — mitigates the cold start that scale-to-zero implies.

Add an Artifact Registry cleanup policy (keep the 3 most recent images) to stay
under the 0.5 GB free allowance. That also bounds how far back you can roll.

The server is safe to autoscale: no battle state is held in memory across
requests, and session state lives in the database, not in-process. The only
in-process state is read-only memoized dex derivation, which is pure — a cold
start cost, not a correctness concern.

## 6. Hosting

```sh
VITE_BASE=/battler/ npm --prefix frontend run build
firebase deploy --only hosting
```

Firebase serves `hosting/` as the site root, and the build emits into
`hosting/battler/`, so `index.html` and `assets/` land at exactly the paths
`base: '/battler/'` generates — no copy step, no cross-platform shell script.

## 7. Custom domain — still outstanding

The `.xyz` domain is bought but not wired up; production is only on the default
`web.app` address. Add the custom domain (and `www`) in Firebase Hosting, then
at the registrar add the TXT verification record and the
two A records Firebase provides. **Keep the registrar's nameservers** — moving
to Cloud DNS would add $0.20/month for no benefit. Managed SSL provisions
within ~24h. Re-run RELEASING.md §5's checks against the real domain once it
resolves.

---

## 8. CI/CD

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) runs the whole
of RELEASING.md §2-§5 on every push to `main`. The runbook side of it — what
runs, what to do when it fails — lives in RELEASING.md §4; this is the setup
that had to exist first.

Nothing in the repo holds a credential, and that is the point of the shape
below. GitHub Actions authenticates to GCP by **Workload Identity Federation**:
the runner presents the short-lived OIDC token GitHub mints for the job, GCP
checks it came from this repository, and hands back an access token that
expires in an hour. No service-account JSON key exists, so there is none to
leak or rotate.

### Step 1 — the identity pool

```sh
PROJECT=<gcp-project-id>
REPO=xDaizu/pokemon-auto-battler
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
SA=github-deployer@$PROJECT.iam.gserviceaccount.com

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project=$PROJECT

gcloud iam workload-identity-pools create github \
  --location=global --display-name='GitHub Actions' --project=$PROJECT

gcloud iam workload-identity-pools providers create-oidc repo \
  --location=global --workload-identity-pool=github --project=$PROJECT \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition="assertion.repository == '$REPO'"
```

⚠️ **`--attribute-condition` is not optional.** Without it the provider trusts
every token GitHub's issuer mints — for any repository on github.com — and any
of them can then impersonate the deployer. `gcloud` refuses to create a
provider for a public issuer without one; that refusal is a feature, so add the
condition rather than looking for a way around it.

### Step 2 — the deployer service account

```sh
gcloud iam service-accounts create github-deployer \
  --display-name='GitHub Actions deployer' --project=$PROJECT

for role in roles/run.admin \
            roles/cloudbuild.builds.editor \
            roles/artifactregistry.admin \
            roles/storage.admin \
            roles/secretmanager.secretAccessor \
            roles/firebasehosting.admin \
            roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:$SA" --role="$role" --condition=None
done

# `gcloud run deploy` must be allowed to assign the runtime service account.
gcloud iam service-accounts add-iam-policy-binding \
  $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser --project=$PROJECT
```

Why each one: `run.admin` deploys the service; `cloudbuild.builds.editor` plus
`storage.admin` cover `--source .`, which stages a tarball in GCS and builds
it; `artifactregistry.admin` lets the first deploy create the
`cloud-run-source-deploy` repository (`artifactregistry.writer` is enough once
it exists); `secretmanager.secretAccessor` is what lets the migrate job read
`DATABASE_AUTH_TOKEN` instead of GitHub holding a copy; the two Firebase roles
cover `firebase deploy --only hosting`.

### Step 3 — let this repository impersonate it

```sh
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# The value that goes into the GCP_WORKLOAD_IDENTITY_PROVIDER secret:
gcloud iam workload-identity-pools providers describe repo \
  --location=global --workload-identity-pool=github --project=$PROJECT --format='value(name)'
```

To restrict deploys further — only from `main`, say — bind
`attribute.repository_ref/refs/heads/main` instead, having added
`attribute.ref=assertion.ref` to the attribute mapping in step 1.

### Step 4 — the GitHub configuration

The split is deliberate. **Variables** are the values that are already public
in this repo or trivially discoverable, and being able to read them in the
Actions UI is worth more than hiding them. **Secrets** are masked in logs and
write-only once set.

Repository **variables** (Settings → Secrets and variables → Actions → Variables):

| Name | Value |
|---|---|
| `GCP_PROJECT_ID` | `<gcp-project-id>` |
| `GCP_REGION` | `europe-west1` |
| `CLOUD_RUN_SERVICE` | `pab-api` |
| `BASE_PATH` | `/battler` |
| `VITE_BASE` | `/battler/` — **trailing slash mandatory** |
| `SITE_URL` | `https://<your-firebase-project-id>.web.app`, or the custom domain once it resolves |

Repository **secrets**:

| Name | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | the `projects/…/providers/repo` resource name from step 3 |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@<gcp-project-id>.iam.gserviceaccount.com` |
| `DATABASE_URL` | the `libsql://…` URL from the gitignored `.env.prod` |

The first two are identifiers rather than credentials — they grant nothing on
their own, since the `principalSet` binding is what decides who may use them.
They are secrets by convention. `DATABASE_URL` is a secret because this repo
has never committed the production database hostname and this is not the place
to start.

Via the `gh` CLI, from the repo root. ⚠️ **Run these in Git Bash, not
PowerShell** — piping a string into a native command in Windows PowerShell
prepends a UTF-8 BOM, which lands inside the stored secret and breaks the
deploy in a way nothing reports until the container refuses to boot
(RELEASING.md §7):

```sh
gh variable set GCP_PROJECT_ID    --body <gcp-project-id>
gh variable set GCP_REGION        --body europe-west1
gh variable set CLOUD_RUN_SERVICE --body pab-api
gh variable set BASE_PATH         --body /battler
gh variable set VITE_BASE         --body /battler/
gh variable set SITE_URL          --body https://<your-firebase-project-id>.web.app

gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --body 'projects/…/providers/repo'
gh secret set GCP_SERVICE_ACCOUNT --body "github-deployer@<gcp-project-id>.iam.gserviceaccount.com"
gh secret set DATABASE_URL --body "$(grep -oP '(?<=^DATABASE_URL=).*' .env.prod)"
```

### Step 5 — the `production` environment and its reviewer

Every job from `plan` onwards declares `environment: production` — `plan`
included, even though it touches nothing, so that its preflight can read the
secrets and so the approval below is asked once, up front.

Under **Settings → Environments → New environment**, named exactly
`production`:

1. Tick **Required reviewers** and add yourself. Save.
2. Optionally set **Deployment branches** to *Selected branches* → `main`, so a
   workflow on a branch cannot reach the environment even if one is added later.
3. Optionally move the three secrets from step 4 here, as environment secrets
   rather than repository secrets. Same effect, tighter scope.

**The required reviewer is the brake.** Without it, every push to `main`
deploys to production unattended. With it, the run stops after the tests and
waits for you — **once**.

That "once" is a property of the job layout, not a given. GitHub creates a
deployment record per *job* and gates each one separately, so a workflow that
spread migrate / API / Hosting across three jobs would ask three times. They
are one `deploy` job precisely so it asks once, which costs nothing: the three
have to run in that order anyway, so splitting them would buy only log
granularity. `plan` and `verify` deliberately declare no environment — `plan`
because its summary table is what you want to *read* before approving, and
`verify` because it only reads the public site.

Keep that in mind before adding a job here: any new job with
`environment: production` is another click, forever.

Environment protection rules are free on public repositories, which this one
is. On a private repo they need GitHub Pro or Team.

### What stays out of GitHub

`SESSION_SECRET` and `DATABASE_AUTH_TOKEN` are never copied into GitHub. Cloud
Run reads them straight from Secret Manager via `--set-secrets`, and the
migrate job fetches the token at run time with `gcloud secrets versions
access`. Rotating the token (RELEASING.md §8) therefore needs no change to any
GitHub setting.

`.env.prod` is likewise never uploaded: the deploy job writes a one-line copy
into `$RUNNER_TEMP`, outside the checkout, so `gcloud run deploy --source .`
cannot sweep it into the build context.
