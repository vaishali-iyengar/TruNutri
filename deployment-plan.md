# Deployment Plan

Step-by-step runbook for Phase 7 of [implementation-plan.md](implementation-plan.md): getting both apps live, per [architecture.md](architecture.md)'s deploy design (Vercel for `frontend/`, Railway for `backend/` + Postgres). This is a plan to follow when you're ready to execute — no deployment has happened yet as of writing this.

## Current State (as of writing)

- Local git repo exists but has **zero commits** and **no remote** — `git status` shows everything staged, nothing committed or pushed.
- No `gh`, `railway`, or `vercel` CLI installed locally.
- `backend/.env` and `frontend/.env.local` hold real secrets (`GROQ_API_KEY`, local `DATABASE_URL`) and are correctly gitignored — confirmed via `git check-ignore` before anything is staged. Never let these leave your machine; only their `.example` counterparts should be tracked.
- Both apps already have the scripts each platform auto-detects: backend `build`/`start`, frontend `build`/`start` (`next build` → `next start`).

## Code Changes Made For Deployment

These were implemented and verified locally before writing the rest of this plan, so the manual steps below are simpler than an earlier draft of this plan assumed:

- **`backend/package.json`**: `start` is now `npm run db:migrate && node dist/index.js` instead of just `node dist/index.js`. `drizzle-kit migrate` is idempotent — it tracks which migrations already ran and no-ops on the rest — so running it on every deploy is safe and removes the "someone forgot to run the migration" failure mode entirely. Verified locally: ran `npm run build && npm run start` against the already-migrated local database, confirmed migration no-ops (`migrations applied successfully` with nothing new to apply) and the server still comes up healthy on `/health`.
- **`backend/package.json`**: moved `drizzle-kit` from `devDependencies` to `dependencies` — it's now invoked at runtime (via the `start` script above), not just during local development, so it needs to survive into whatever `node_modules` the production environment actually runs with.
- **`backend/railway.json`**: added, with `healthcheckPath: "/health"` (reuses the existing health endpoint), an explicit `startCommand`, and `restartPolicyType: "ON_FAILURE"` with a retry cap — this makes Railway's build/deploy/health-check behavior version-controlled and reviewable in the repo, rather than only existing as unrecorded clicks in the Railway dashboard.
- **`frontend/next.config.ts`**: reviewed, no changes needed — Vercel's zero-config Next.js detection handles this app as-is.

## Why This Order

Railway and Vercel each need the *other's* URL before they're fully working (backend needs the frontend's origin for CORS; frontend needs the backend's URL to call it), so this can't be done in one pass. The order below deploys backend first with a placeholder CORS origin, gets the frontend's real URL, then comes back and fixes the backend's CORS setting. Attempting it in the "obvious" order (frontend first) just means doing the same loop in the other direction.

## Step 0 — Push to GitHub

Both Railway and Vercel deploy from a git repo, so this has to happen first.

1. Review what's staged one more time — `git status`, and specifically confirm no `.env` files appear (only `.env.example`/`.env.local.example`).
2. Commit: `git commit -m "Initial commit"` (or your preferred message).
3. Create a GitHub repo (via `gh repo create` or the GitHub web UI) — decide public vs. private now, since it's awkward to change later if the repo has any history you'd rather not expose.
4. `git remote add origin <url>` and `git push -u origin main`.

**Stop and confirm before this step** if you haven't already decided public/private and aren't set up with `gh auth login` or an SSH key — this is the first action in the whole plan that leaves your machine.

## Step 1 — Railway: Backend + Postgres

**✅ Done.** Live at `https://trunutri-production.up.railway.app`. Three real issues came up executing this step, none of them hypothetical:

1. **Free-plan resource limit** — the first Railway account hit "Free plan resource provision limit exceeded" on `railway init`, because the account already had 2 other projects. Resolved by creating a fresh Railway account rather than touching the user's existing unrelated projects.
2. **Orphaned service from a failed dashboard connection** — an earlier manual attempt to link the GitHub repo in the Railway dashboard failed with a generic "There was an error deploying from source." The service existed in the dashboard, but querying Railway's GraphQL API directly showed it had zero `ServiceInstance` records in any environment — a dangling shell, not a real deploy target. `serviceConnect`/`serviceInstanceUpdate` mutations against it succeeded but silently did nothing. Fixed by deleting that service and recreating it via `serviceCreate` with `source: { repo }` set at creation time, which produced a real instance immediately.
3. **Groq model deprecation** — unrelated to Railway itself, only surfaced once the live smoke test ran. `llama-3.3-70b-versatile` no longer exists on Groq's side at all (confirmed via `GET /v1/models`); switched the default to `openai/gpt-oss-120b`. Full story in implementation-plan.md's Phase 7 entry and edge-cases.md.

The steps below are kept as the reference procedure for next time (e.g. redeploying, or setting this up again from scratch) rather than rewritten as a narrative of what happened.

1. Create a new Railway project.
2. **Add a Postgres database** to the project first (Railway's own add-on) — this auto-creates a `DATABASE_URL`-shaped connection and makes it available to other services in the same project via Railway's variable references.
3. **Add a service from your GitHub repo** (the same repo, not a separate one).
4. In that service's settings, set **Root Directory** to `backend` — this is the monorepo config from architecture.md's "Monorepo Deploy Config"; without it Railway will try to build the repo root, which has no `package.json`.
5. Set environment variables on the backend service:

   | Var | Value |
   |---|---|
   | `GROQ_API_KEY` | your real key |
   | `GROQ_MODEL` | `openai/gpt-oss-120b` (or leave unset — this is the code default) |
   | `DATABASE_URL` | reference the Postgres add-on's connection string (Railway lets you reference another service's variable directly, e.g. `${{Postgres.DATABASE_URL}}`) |
   | `FRONTEND_ORIGIN` | a placeholder for now (e.g. `http://localhost:3000`) — **you will come back and fix this in Step 3** |
   | `PORT` | leave unset; Railway injects its own `PORT` and the app already reads `process.env.PORT` |

6. Deploy. Railway should auto-detect the Node app (Nixpacks), run `npm install` + `npm run build`, then `npm run start` — which now runs the migration automatically before starting the server (see "Code Changes Made For Deployment" above), so there's no separate manual migration step here anymore.
7. Confirm the backend is actually up: hit `https://<your-railway-domain>/health` and expect `{"ok":true}`. If it's not up, check the deploy logs first for a migration failure (e.g. `DATABASE_URL` not resolving) before assuming the app itself is broken — the server won't start at all if the migration step fails, by design.
8. **Note the backend's public URL** — you'll need it in Step 2.

## Step 2 — Vercel: Frontend

**✅ Done.** Live at `https://tru-nutri.vercel.app`. Hit the exact same failure class as Railway's Step 1 issue #2: the project had `rootDirectory: null` and `framework: null` at the API level. The dashboard showed a green "Ready" deployment, but its build log had no install/build step at all — just `Build Completed in /vercel/output [85ms]` and "no files were prepared." It technically succeeded while building nothing, so every route (including the per-deployment URL, not just the custom alias) returned Vercel's own edge-level `x-vercel-error: NOT_FOUND`. This user's Vercel UI also didn't show a Root Directory field under Settings → General where expected, which made dashboard-only debugging a dead end. Fixed via the API: `PATCH /v9/projects/:id` with `{"rootDirectory": "frontend", "framework": "nextjs"}`, then `POST /v13/deployments` with `gitSource` to trigger a fresh build — which then showed the expected `npm install` → `next build` → `Route (app) ┌ ○ /` output. Also removed a stray unrelated `API_BASE` env var found on the project and added the correct `NEXT_PUBLIC_BACKEND_URL`.

1. Create a new Vercel project from the same GitHub repo.
2. Set **Root Directory** to `frontend` in the project's settings.
3. Set the environment variable:

   | Var | Value |
   |---|---|
   | `NEXT_PUBLIC_BACKEND_URL` | the Railway backend's public URL from Step 1.8 (must be `https://` — see Gotchas below) |

4. Deploy. Vercel auto-detects Next.js; no build command overrides needed.
5. **Note the frontend's public URL** — you'll need it in Step 3.

## Step 3 — Close the Loop: Fix CORS on Railway

**✅ Done — with a real gotcha not in the original plan.** Setting `FRONTEND_ORIGIN=https://tru-nutri.vercel.app` (no trailing slash — the exact value a browser's `Origin` header sends) resulted in Railway serving the CORS response header **with** a trailing slash (`https://tru-nutri.vercel.app/`), confirmed via raw header bytes. The identical code running locally with the identical env var does *not* add a slash, so this happens somewhere in Railway's proxy layer, not in our app. Browsers correctly reject the mismatch as invalid CORS (confirmed with a real headless browser: `fetch()` failed with an explicit "not equal to the supplied origin" error). **Workaround, verified empirically:** set the env var *with* a trailing slash (`https://tru-nutri.vercel.app/`) — this results in the header going out *without* one, and a real browser then completes the request with zero console errors. Root cause not fully understood; if this changes in a future Railway update, re-check with the raw-header `curl` command below before assuming the trailing-slash workaround is still needed.

1. Go back to the Railway backend service's environment variables.
2. Set `FRONTEND_ORIGIN` to the real Vercel URL from Step 2.5. **Despite the "no trailing slash" advice further down this doc, add one anyway** (`https://your-app.vercel.app/`) — see the gotcha above. Verify with:
   ```bash
   curl -s -D - -o /dev/null -X OPTIONS https://<railway-domain>/api/chat \
     -H "Origin: https://<vercel-domain>" \
     -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
   ```
   The value after `access-control-allow-origin:` must exactly match your Vercel origin with **no** trailing slash — adjust which way you set the env var until this is true, don't assume either way.
3. Redeploy/restart the Railway service so the new env var takes effect (`cors()` reads it at process startup, not per-request).

This is the step [edge-cases.md](edge-cases.md) explicitly warns is easy to forget — the app will *look* deployed after Step 2, but every request from the real frontend will fail CORS until this step happens.

## Step 4 — Smoke Test

**✅ Done.** Verified with a real headless browser against `https://tru-nutri.vercel.app`: asked an in-scope question, got a full answer with numbered claims and "Source: not yet available" chips rendered, zero console errors. This confirmed the cross-origin path specifically (the one thing that differs from local dev); the full state matrix (decline, network-error, reload) was already verified on localhost in Phase 6 and isn't origin-dependent.

In an incognito window (to rule out any local `localStorage`/cookie state):

1. Open the Vercel URL.
2. Ask a normal in-scope question (e.g. one of the three suggested questions) — confirm an answer with claims renders.
3. Ask an out-of-scope question (e.g. "What should I weigh for my height?") — confirm the "Out of scope" decline renders.
4. Reload the page — confirm the app doesn't crash (note: per edge-cases.md, the visible chat will reset even though the conversation continues server-side — this is a known, already-documented gap, not something to debug here).
5. Open the browser's Network tab on the successful question from step 2 and confirm the response's `claims[].source` is `null` — this is Phase 8's "Source fields must stay null" rule, now checkable on a live deployment.

This matches implementation-plan.md's Phase 7 exit check: *"the public Vercel URL, opened in an incognito window, produces a working conversation end to end."*

## Environment Variable Reference

| Var | Platform | Notes |
|---|---|---|
| `GROQ_API_KEY` | Railway | Never in frontend code or any `NEXT_PUBLIC_*` var |
| `GROQ_MODEL` | Railway | Optional, defaults to `openai/gpt-oss-120b` in code |
| `DATABASE_URL` | Railway | Reference the Postgres add-on's own variable, don't hardcode |
| `FRONTEND_ORIGIN` | Railway | Must be the exact Vercel origin — set in Step 3, after Step 2 |
| `NEXT_PUBLIC_BACKEND_URL` | Vercel | Must be `https://` — set in Step 2, after Step 1 |

## Gotchas (from edge-cases.md's Deployment section — read before you hit them)

- **`FRONTEND_ORIGIN` set before the real Vercel URL exists** — see Step 3; this is the most likely thing to get skipped.
- **HTTPS mixed content** — if `NEXT_PUBLIC_BACKEND_URL` is ever `http://` while the Vercel frontend serves over `https://`, the browser silently blocks the request. Always double-check the scheme.
- **Railway cold starts** — if the service scales to zero after idle, the first request post-idle may be slow enough to look like a network error rather than a slow one. Not fixed in code; just be aware when smoke-testing after a period of inactivity.
- **Vercel preview deployments** (if you open PRs later) get their own URL, which won't match `FRONTEND_ORIGIN` and will fail CORS. Out of scope for this initial deploy — revisit if/when preview deploys matter.
- **Railway restarts** — no in-memory state to lose (everything's in Postgres), but worth confirming once that `DATABASE_URL` still resolves correctly after a redeploy, not just on first deploy.

## Rollback

- **Frontend**: Vercel keeps every deployment; roll back to a previous one from the project's Deployments tab — instant, no rebuild needed.
- **Backend**: Railway keeps deployment history too; redeploying a previous build is similarly a dashboard action, not a git revert.
- **Database**: migrations in this project are additive only so far (no destructive migrations have been written) — there's no rollback migration to run. If a future migration needs to be reverted, that has to be written by hand; `drizzle-kit` doesn't auto-generate down-migrations.

## After This Plan Runs

Update implementation-plan.md's Phase 7 checklist to `[x]` with the actual Railway/Vercel URLs noted, and proceed to Phase 8's wrap-up checks (several of which — "app live at a public URL," source fields staying `null` on a live response — depend on this plan having actually been executed).
