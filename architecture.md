# Architecture Plan

Architecture for the prototype described in [problem-statement.md](problem-statement.md).

## Overview

```
┌─────────────────────┐        HTTPS         ┌──────────────────────┐        ┌───────────────┐
│  Frontend (Vercel)  │ ───────────────────▶ │  Backend (Railway)   │ ─────▶ │  Model API     │
│  Next.js            │ ◀─────────────────── │  Node.js / Express   │ ◀───── │ (Groq /        │
│                      │      JSON response    │  + Zod validation     │        │  Llama 3.3)    │
└─────────────────────┘                       └──────────┬───────────┘        └───────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │  Postgres (Railway)  │
                                               │  conversations,      │
                                               │  messages, failures  │
                                               └──────────────────────┘
```

The model is never called from the browser. The frontend only talks to the backend's chat endpoint.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript | Deploys cleanly to Vercel, simple client/server split |
| Backend | Node.js + Express + TypeScript | Deploys cleanly to Railway, minimal ceremony |
| Database | Postgres (Railway add-on) | Stores conversations, messages, and failure records |
| Schema validation | Zod | Defines the response schema once, validates model output against it |
| Model | Groq (Llama 3.3 70B Versatile) | OpenAI-compatible chat completions API with forced function/tool calling; fast inference, no prose parsing |

## Frontend

- **Visual design** — ported from `stitch_ai_nutrition_assistant_ui/warm_editorial_wellness/DESIGN.md` ("Warm Editorial Wellness"): Playfair Display for headings + Plus Jakarta Sans for body text (loaded via `next/font/google`), a warm cream/forest-green/ochre/terracotta color system defined as Tailwind v4 `@theme` tokens in `globals.css` (copied verbatim from the design system's own Tailwind config so class names like `bg-primary`/`text-on-surface-variant` match 1:1), and rounded, pill-shaped, editorial-card component shapes. The source mockups describe a much larger fictional product ("Nourish.ai" — multi-conversation history sidebar, dietary profile, a citation-rigor-scored source library, fabricated "verified" badges); only the visual language was ported, not those unbuilt features — the app's actual scope (single conversation, placeholder sources panel, no auth) stayed the same, and no fabricated "verified"/citation-count copy was carried over, since that would misrepresent what the app actually does this milestone.
- **Empty state** — a short intro line setting expectations (answers come from general knowledge, not a verified source, not a substitute for medical/professional advice) plus three clickable suggested questions that send that exact text as the first message, so a new user isn't staring at a blank input.
- **Message list** — renders the conversation, one entry per turn.
- **Input box** — sends a new user message to the backend, disabled while a response is pending.
- **Sources panel** — a persistent panel beside the conversation. Deliberately kept as a designed placeholder ("Sources coming soon") in this milestone rather than wired to real data — Milestone 2 will populate it from the `claims[].source` field once real sources exist. Note this is distinct from the short inline citation-style mention that the system prompt now asks the model to include directly in the answer/claim text; that inline mention is not a substitute for the structured source the panel will eventually show.
- No API keys, no model SDK, no system prompt — all of that stays server-side. The frontend only calls the backend's `/api/chat` endpoint and renders whatever comes back.

## Backend

### Endpoint

`POST /api/chat`

Request:
```json
{ "conversationId": "uuid | null", "message": "string" }
```

Response (on success):
```json
{
  "conversationId": "uuid",
  "answer": "string",
  "claims": [
    { "text": "string", "source": null }
  ]
}
```

Response (on scope violation):
```json
{
  "conversationId": "uuid",
  "answer": "I can't help with that — please talk to a qualified professional.",
  "claims": [],
  "declined": true,
  "reason": "medical_advice" 
}
```

### Request flow

1. Receive message, load conversation history (if `conversationId` given).
2. **Scope check (code, pre-model)** — run the message through a rule-based/keyword+intent filter for calorie/weight targets, weight recommendations, medical advice. If flagged, short-circuit: return a decline response, log it, skip the model call entirely.
3. Call the model with the system prompt + structured output schema (tool-use/JSON schema mode).
4. Validate the raw model response against the Zod schema.
   - **Pass** → persist message + response, return to client.
   - **Fail** → persist a failure record (raw output, error, timestamp, conversation context), return a generic error to the client. Do not retry-and-hide; the failure is recorded as-is.
5. **Scope check (code, post-model)** — even if the model itself produces calorie/weight/medical content despite the system prompt, a second pass over the model's `answer` text catches it before it reaches the client, logs it as a scope violation, and returns the decline response instead.

### Why two scope checks

The prompt tells the model what not to do; the pre-check stops obviously out-of-scope questions before spending a model call; the post-check catches cases where the model ignores the instruction. Neither is a substitute for the other.

## Data Model (Postgres)

```
conversations
  id            uuid pk
  created_at    timestamptz

messages
  id                uuid pk
  conversation_id   uuid fk -> conversations.id
  role              text        -- 'user' | 'assistant'
  content           text
  claims            jsonb        -- [{ text, source }]
  created_at        timestamptz

failures
  id                uuid pk
  conversation_id   uuid fk -> conversations.id, nullable
  kind              text        -- 'schema_validation' | 'scope_violation' | 'model_error'
  raw_output        text
  detail            jsonb
  created_at        timestamptz
```

`failures` is the durable record required by "failures must be recorded, not patched around" — nothing gets silently retried or swallowed without a row here.

## Response Schema (Zod, shared source of truth)

```ts
const ClaimSchema = z.object({
  text: z.string(),
  source: z.null(), // stays null until Milestone 2 wires up real sources
});

const ChatResponseSchema = z.object({
  answer: z.string(),
  claims: z.array(ClaimSchema),
});
```

This schema is passed to the model as its function-calling tool schema (Groq's OpenAI-compatible `tools` + forced `tool_choice`), so the model is constrained at generation time, not just checked after the fact. The Zod parse is the second, authoritative gate — if it fails, the request fails, no fallback prose parsing.

## System Prompt

Stored server-side as a single versioned file (e.g. `backend/prompts/system.ts`), covering:

- **What it does** — answers questions about food, nutrition, and food safety, from the model's general knowledge.
- **Tone** — conversational, like texting a knowledgeable friend, not writing a spec sheet: contractions, casual openers ("Yeah,"/"Yep,"), short separate sentences rather than semicolon-stitched clauses, and plain descriptions over precise technical units (e.g. "keep it cold" over "≤40 °F") unless the number itself is the point. The prompt anchors this with a concrete before/after example rather than adjectives alone — abstract instructions like "be warm and conversational" were tried first and didn't move the actual output much.
- **How it answers** — the answer/claim comes first, with a short inline citation-style mention of where the fact comes from (e.g. "…per USDA guidance"); bullets are allowed when the query calls for a list. This is purely a text-formatting convention inside `answer`/`claims[].text` — it does **not** change the schema. `claims[].source` still stays `null` (Rules: "Source fields must stay `null`"); the detailed, structured source is what Milestone 2's real sourcing work will populate, and the inline mention is not treated as that structured source.
- **Length** — the core answer is capped at 1000 characters (raised from an initial 300-character cap per a later problem-statement.txt update); the trailing inline source mention is exempt from that budget (it's a short tag, not part of the answer's substance) but is still expected to stay brief on its own. This is a soft, prompt-level constraint only; nothing in code currently truncates or rejects an over-length answer (see edge-cases.md). The eval suite (`backend/src/evals/run.ts`) approximates the exemption with a regex that strips a trailing `"per ..."/"according to ..."` clause before measuring length — a heuristic, not a real parser, since the schema has no structural separation between the two.
- **What it won't touch** — calorie/weight targets, weight recommendations, medical advice; redirect to a qualified professional.

### Prompt regression testing

- A fixed set of eval questions lives in `backend/evals/questions.json` (mix of in-scope and out-of-scope cases).
- A script runs all of them against the backend after every system-prompt change and diffs the outputs against the previous run.
- This is a manual/CI-triggered step, not user-facing — its job is to catch "fixed one case, broke three others."

## Scope Limits, Enforced in Code

Implemented as `backend/scope/guard.ts`, using a **regex/keyword list**, not a second model call — it must run before the model call with no added latency or cost, and it must be deterministic so the eval suite can assert on it reliably.

- Three category patterns: `calorie_or_weight_target` (e.g. "how many calories should I eat", "what should I weigh"), `weight_recommendation` ("should I lose/gain weight"), `medical_advice` ("diagnose", "is this a symptom of", drug/dosage names).
- Runs **pre-model** on the incoming user message (cheap, fast reject, skips the model call entirely) and **post-model** on the generated `answer` text (safety net — logged as a more serious violation, since it means the system prompt itself failed).
- Every trigger — pre or post — is written to the `failures` table with `kind: 'scope_violation'` and the matched category in `detail`, independent of whether the system prompt would have refused on its own.
- Keyword lists start small and are extended as the eval suite (below) surfaces misses; they are not meant to be exhaustive on day one.

## Environment Variables

| Var | Where | Purpose |
|---|---|---|
| `GROQ_API_KEY` | Railway (backend) | Model calls |
| `GROQ_MODEL` | Railway (backend) | Model id override, defaults to `llama-3.3-70b-versatile` |
| `DATABASE_URL` | Railway (backend, auto-set by Postgres add-on) | Postgres connection |
| `FRONTEND_ORIGIN` | Railway (backend) | CORS allowlist, set to the Vercel URL |
| `NEXT_PUBLIC_BACKEND_URL` | Vercel (frontend) | Base URL the frontend calls |

No model key is ever present in frontend code or env vars prefixed `NEXT_PUBLIC_`.

## Monorepo Deploy Config

Single GitHub repo, two independent deploy targets:
- **Vercel** project root directory → `frontend/`. Auto-deploys on push to `main`.
- **Railway** service root directory → `backend/`. Auto-deploys on push to `main`, with the Postgres add-on attached to the same Railway project (so `DATABASE_URL` is injected automatically).

## Frontend Session Handling

- On first load, if no `conversationId` exists in `localStorage`, the frontend sends `conversationId: null`; the backend creates a row in `conversations` and returns the new id, which the frontend then persists to `localStorage`.
- Subsequent messages send the stored `conversationId`; the backend loads prior `messages` for that id to build model context.
- "New conversation" clears `localStorage` and starts over.

## Frontend States

The message list / input box must distinguish four response states, not just success:
- **Pending** — input disabled, a loading indicator in place of the next assistant message.
- **Success** — normal answer + claims rendered; sources panel stays on its placeholder text (empty for now). Since the system prompt may now return bullet-formatted answers, the message list should render `answer` as at least basic Markdown (or line-broken plain text) rather than a single unbroken paragraph, so bullets are visually legible.
- **Declined** (`declined: true`) — rendered like a normal assistant message but visually marked (e.g. a small icon/label) so it reads as a policy decline, not a normal answer.
- **Error** (schema validation failed or model/network error) — a distinct inline error message ("Something went wrong, try again"), never silently retried, never shown as if it were a real answer.

## Model Call Shape

Groq (OpenAI-compatible chat completions API), forced structured output via function calling:

```ts
const response = await groq.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
  tools: [{
    type: "function",
    function: {
      name: "respond",
      description: "Return the structured chat response.",
      parameters: zodToJsonSchema(ChatResponseSchema),
    },
  }],
  tool_choice: { type: "function", function: { name: "respond" } },
});
// JSON.parse(response.choices[0].message.tool_calls[0].function.arguments)
// is validated against ChatResponseSchema with Zod
```

Forcing `tool_choice` guarantees the model's output shape matches the schema going in; the Zod parse afterward is still the authoritative gate (rule: "every response must parse against your schema").

## Database Migrations

Use **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) for schema definition and migrations — lightweight, typed, and keeps the schema in `backend/db/schema.ts` as the single source of truth, migrated via `drizzle-kit generate` / `drizzle-kit migrate` against `DATABASE_URL`.

## Eval Script

`backend/evals/run.ts`:
- Reads `backend/evals/questions.json` — a fixed list of `{ question, expectCategory: string | null }` pairs (in-scope questions with `expectCategory: null`, out-of-scope ones naming the expected decline category).
- Sends each through the real `/api/chat` flow (in-process call, not over HTTP) and records: schema-valid?, declined-as-expected?, raw answer text.
- Writes a dated snapshot to `backend/evals/results/<timestamp>.json` and diffs against the most recent prior snapshot, printing which questions flipped outcome.
- Run manually (`npm run eval`) after every system-prompt or scope-guard change, before committing.

## Deployment

- **Frontend** → Vercel, deployed from the `frontend/` directory, environment configured with the backend's public URL.
- **Backend** → Railway, deployed from `backend/`, with the Postgres add-on provisioned in the same Railway project. Model API keys live in Railway environment variables only.
- **GitHub** → single repo, two deploy targets (Vercel watches `frontend/`, Railway watches `backend/`), so both redeploy on push to `main`.

## Suggested Repo Layout

```
ai-nutrition-assistant/
  frontend/          # Next.js app (Vercel)
  backend/           # Express app (Railway)
    src/
      routes/chat.ts
      schema/response.ts
      prompts/system.ts
      scope/guard.ts
      db/
      evals/
  problem-statement.md
  architecture.md
```
