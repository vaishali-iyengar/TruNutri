# Implementation Plan

Phase-wise plan for building [problem-statement.md](problem-statement.md) per [architecture.md](architecture.md). Each phase should leave the app in a runnable state; don't start a phase until the previous one's checklist is green.

Status markers: `[x]` done, `[ ]` not started.

## Phase 0 — Repo & Tooling Scaffold

Goal: both apps exist, install, build, and typecheck, with nothing wired together yet.

- [x] Git repo initialized.
- [x] `frontend/` — Next.js (App Router, TypeScript, Tailwind) via `create-next-app`.
- [x] `backend/` — Express + TypeScript, `package.json`, `tsconfig.json`.
- [x] Backend deps installed (`groq-sdk`, `express`, `zod`, `drizzle-orm`, `pg`, etc.), typechecks clean.
- [x] Frontend builds clean.
- [x] Root `README.md`, `.gitignore`, `.env.example` files in place.

**Exit check:** `npm run build` succeeds in both `frontend/` and `backend/`.

## Phase 1 — Data Layer

Goal: schema and migrations exist and can be applied to a real Postgres instance.

- [x] Drizzle schema (`conversations`, `messages`, `failures`) written in `backend/src/db/schema.ts`.
- [x] `drizzle.config.ts` configured, initial migration generated (`backend/drizzle/0000_*.sql`).
- [x] Provision a real Postgres instance (Railway add-on, or local Postgres for dev) and set `DATABASE_URL`.
- [x] Run `npm run db:migrate` against it and confirm the three tables exist.

**Exit check:** can insert and read a row in `conversations` via `psql` or a quick script.

## Phase 2 — Response Schema & Model Call

Goal: a single function that takes conversation history and returns a schema-validated response, independent of HTTP/Express.

- [x] `ChatResponseSchema` / `ClaimSchema` defined in `backend/src/schema/response.ts` (`source` fixed to `z.null()`).
- [x] `callModel()` in `backend/src/model/client.ts` — Groq call with forced `tool_choice`, `zodToJsonSchema` for the tool's `parameters`, Zod `safeParse` on the result.
- [x] Set `GROQ_API_KEY` and manually exercise `callModel()` with a couple of hand-written prompts (a scratch script is fine) to confirm real responses parse.
- [x] Confirm the failure path: feed it something that can't parse (or temporarily break the schema) and verify `parsed: null, error: <message>` comes back rather than throwing.

**Exit check:** at least one real model call round-trips through `ChatResponseSchema` successfully, and the parse-failure path returns an error object instead of throwing.

## Phase 3 — System Prompt & Eval Suite

Goal: a versioned prompt plus a repeatable way to tell if a prompt change broke something.

- [x] `SYSTEM_PROMPT` written in `backend/src/prompts/system.ts` (role, answer style, length cap, refusal areas).
- [x] Fixed question set in `backend/src/evals/questions.json` (in-scope + out-of-scope cases).
- [x] `backend/src/evals/run.ts` — runs each question through scope-check + model, snapshots to `backend/src/evals/results/`, diffs against the prior run; catches per-question model errors so one bad case doesn't abort the whole run.
- [x] Run `npm run eval` for real (needs `GROQ_API_KEY`) and eyeball the first snapshot — this is the baseline every future prompt change gets diffed against.
- [x] Add 3-5 more questions if the current 10 don't cover an edge case you're worried about (e.g. borderline phrasing of a diet question).

**Exit check:** `npm run eval` runs clean and produces a results snapshot; re-running with no changes produces "no flips." ✅ 10/10 baseline established, re-run confirmed "no flips." 5 borderline questions added (15 total); 2 of them (an indirect weight-loss request and a specific-calorie-target diet plan) exposed real scope-guard gaps — tracked as known backlog for Phase 4, not fixed here.

## Phase 4 — Scope Enforcement in Code

Goal: the three disallowed categories are blocked deterministically, not just by prompt wording.

- [x] `checkScope()` in `backend/src/scope/guard.ts` with regex categories: `calorie_or_weight_target`, `weight_recommendation`, `medical_advice`.
- [x] Wired into `chatRouter` both pre-model (skip the call entirely) and post-model (safety net on `answer`).
- [x] Every trigger writes a `failures` row with `kind: 'scope_violation'` and the matched category.
- [x] Run the eval suite specifically for the out-of-scope cases and confirm `matchesExpectation: true` for all of them.
- [x] Deliberately try a phrasing not in `questions.json` that should be caught (e.g. "give me a diet plan to hit 1800 calories") — if it slips through, extend the regex list and re-run evals.

**Exit check:** every out-of-scope eval question is declined pre-model (cheapest path), and the post-model path has been proven to fire at least once (e.g. by temporarily loosening the prompt and confirming the guard still catches it). ✅ All 7 out-of-scope questions in the eval set are now caught pre-model (verified via the snapshot's `answer: null`). The post-model safety net was proven independently with a synthetic non-compliant answer (`checkScope()` correctly flagged it) rather than relying on a real question to reach it. Three regex gaps found and fixed along the way: a specific-calorie-target pattern (tightened after an initial version false-positived on "an apple has 95 calories"), a specific-weight-change-amount pattern, and a self-diagnosis phrasing pattern for named diseases (previously only matched the generic words "disease/condition/disorder").

## Phase 5 — Chat Endpoint (Full Request Flow)

Goal: `POST /api/chat` implements the full flow end to end against a real database and model.

- [x] `chatRouter` in `backend/src/routes/chat.ts` — conversation creation, pre-check, history load, model call, schema validation, post-check, persistence, response shaping. Hardened in this phase:
  - model call wrapped in try/catch, logging a `model_error` failure row and returning 502 instead of crashing on a Groq API-level error (e.g. rate limit, invalid model, `output_parse_failed`) — first found in Phase 3's testing.
  - `conversationId` is now validated as a well-formed UUID (400 if not) and checked for existence in the DB (404 if not found) before use — previously a nonexistent-but-valid-looking `conversationId` **crashed the entire Node process** via an unhandled foreign-key violation (Express 4 doesn't auto-catch async route errors).
  - the whole handler is now wrapped in try/catch that forwards to `next(err)`, and `index.ts` has a final catch-all error middleware — so no future unhandled error in this route can take the whole server down again.
- [x] `backend/src/index.ts` — Express app, CORS via `FRONTEND_ORIGIN`, `/health`, mounts `chatRouter` at `/api`. Added JSON-parse-error middleware (malformed body → clean 400 JSON instead of Express's default HTML error page) and a catch-all error-handling middleware (last line of defense against process crashes).
- [x] `backend/src/model/client.ts` — found and fixed a reliability bug: `zodToJsonSchema()` includes a top-level `$schema` meta key that doesn't belong in a function-calling `parameters` object; leaving it in made Groq's forced tool-calling unreliable on follow-up turns (the model would sometimes reply in plain text instead of calling the tool, which Groq then rejects with a 400). Stripped before sending.
- [x] With `DATABASE_URL` and `GROQ_API_KEY` set, run `npm run dev` and hit `POST /api/chat` with `curl`/Postman for: a normal question, an out-of-scope question, and a follow-up in the same `conversationId` (confirm history is included).
- [x] Confirm rows land correctly in `conversations`, `messages`, and (for the out-of-scope case) `failures`.

**Exit check:** three manual `curl` calls above all behave as documented in architecture.md's request/response examples. ✅ Verified twice (before and after the fixes above): a normal question got a well-formed answer + claims; the out-of-scope question was declined pre-model with the correct `reason`; a content-based follow-up ("what if it was left out for 3 hours instead?") correctly built on the prior answer, proving history is loaded and used. DB confirmed 1 conversation row, 6 message rows (3 user/3 assistant), 1 `scope_violation` failure row per run. Also verified directly: a broken model config produced a 502 + `model_error` row (no crash); a malformed JSON body produced a clean 400 (no crash); an invalid-format `conversationId` produced a 400; a well-formed but nonexistent `conversationId` produced a 404 instead of crashing the process. Test data cleaned up after each run.

**Update: the meta-question limitation above turned out to be a symptom of a broader bug, now fixed at the root.** It resurfaced in real use as "The model call failed. This has been recorded." on a *content* follow-up ("How about buffalo milk?"), not just meta-questions — meaning the first fix (prompt wording + retry nudge) wasn't the real fix. Root cause: prior assistant turns were replayed to the model as plain text while `tool_choice` was only forced on the current turn, an inconsistent shape that let the model drift into plain-text replies on any follow-up. Fixed in `backend/src/model/client.ts` by reconstructing each prior assistant turn as the actual tool-call the model would have produced (using the `claims` already stored per message), so the whole conversation stays consistently tool-using. Verified across 5 different multi-turn conversations with zero failures, and the full eval suite still passes 15/15 with no flips. See edge-cases.md.

## Phase 6 — Frontend

Goal: chat UI backed by the real endpoint, all four response states handled.

- [x] Chat page (`frontend/app/page.tsx`) — message list, input box, sources panel (reads `claims[].source`, currently always "no source yet").
- [x] `conversationId` persisted to `localStorage`, "New conversation" clears it.
- [x] Pending / success / declined / error states styled distinctly.
- [x] Set `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000` in `.env.local`, run both apps locally, and manually test in a browser:
  - a normal question renders an answer,
  - an out-of-scope question renders with the "Out of scope" label,
  - stopping the backend and sending a message shows the network-error state,
  - reloading the page keeps the same conversation (via `localStorage`).

**Exit check:** all four states above are visually confirmed in a real browser, not just inferred from code. ✅ Verified with Playwright driving a real headless Chromium against both dev servers (backend on :4000, frontend on :3000, Postgres via Postgres.app):
- Normal question → answer rendered in a white bubble, claims populated the sources panel.
- Out-of-scope question → amber "OUT OF SCOPE" label + decline message, in the same conversation.
- Backend killed mid-session, new message sent → red "Couldn't reach the server. Try again." message; input re-enabled afterward (not stuck in pending); no unhandled page error (the `ERR_CONNECTION_REFUSED` console line is the browser's own log of the failed fetch, not an app bug).
- Reload → `conversationId` in `localStorage` confirmed identical before and after reload.

**Gap found (not fixed here, documented in edge-cases.md):** "keeps the same conversation" only holds at the data layer — `conversationId` persists and the backend still has full message history for it (confirmed in Phase 5), but the frontend has no way to fetch and redisplay prior messages, so a reload shows an empty chat window even though the conversation continues correctly server-side. Fixing this needs a new `GET` endpoint (e.g. `/api/conversations/:id/messages`) that isn't in the current architecture — out of scope for a frontend-only phase.

## Phase 7 — Deploy

Goal: the app is live at a public URL, both services talking to each other over the internet.

- [ ] Push repo to GitHub.
- [ ] Railway: new project, deploy `backend/` as a service, attach a Postgres add-on, set `GROQ_API_KEY` and `FRONTEND_ORIGIN` (placeholder until Vercel URL exists), run the migration against the Railway Postgres instance.
- [ ] Vercel: new project, deploy `frontend/`, set `NEXT_PUBLIC_BACKEND_URL` to the Railway backend's public URL.
- [ ] Go back to Railway and set `FRONTEND_ORIGIN` to the real Vercel URL (CORS depends on this).
- [ ] Smoke-test the live URL: normal question, out-of-scope question, page reload keeping conversation.

**Exit check:** the public Vercel URL, opened in an incognito window, produces a working conversation end to end.

## Phase 8 — Milestone Wrap-Up

Goal: confirm every rule in problem-statement.md's "Rules" section is actually satisfied, not just plausible.

- [ ] Every response parses against the schema — verified in Phase 2/5.
- [ ] Claims list + `source` field present — verified in Phase 2 (`source` is always `null`).
- [ ] Source fields stay `null` — check a live response in the browser network tab.
- [ ] Scope limits live in code — verified in Phase 4 (regex guard, not just prompt wording).
- [ ] App live at a public URL — verified in Phase 7.
- [ ] Failures recorded, not patched around — check the `failures` table has rows after Phase 4/5 testing.
- [ ] Model calls run behind the backend — confirm no API key or model SDK reference exists anywhere in `frontend/`.
