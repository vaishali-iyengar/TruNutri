# TruNutri

TruNutri is a chat assistant for everyday food, nutrition, and food-safety questions — things like "is it safe to eat eggs past the sell-by date?" or "what foods are high in vitamin C?". Ask a question in plain language and get back a direct answer, broken down into individual claims so you can see exactly what's being asserted rather than one opaque paragraph.

It deliberately stays in its lane: questions outside food/nutrition/food-safety (medical diagnoses, unrelated topics, etc.) are declined rather than answered, since the assistant is meant to be a focused, trustworthy source for this one domain rather than a general-purpose chatbot. Answers currently come from the underlying model's own knowledge — there's no external source lookup yet, so claims are shown without a citation (see [problem-statement.md](problem-statement.md) for the brief and [architecture.md](architecture.md) for the full design, including where source attribution is headed next).

## Tech stack

| Layer | Choice | Deploy target |
| --- | --- | --- |
| Frontend | [Next.js](https://nextjs.org/) (App Router, React 19), [Tailwind CSS v4](https://tailwindcss.com/) | [Vercel](https://vercel.com/) |
| Backend | [Express](https://expressjs.com/) + TypeScript, [Drizzle ORM](https://orm.drizzle.team/) + Postgres, [Zod](https://zod.dev/) for response validation | [Railway](https://railway.app/) |
| Model | [Groq](https://groq.com/) (`groq-sdk`), model `openai/gpt-oss-120b` | Groq-hosted inference API |

**Frontend** — a single-page chat UI: message list, input bar, collapsible claims-and-sources per answer, and a conversation-history sidebar backed by `localStorage` (no login/accounts).

**Backend** — exposes a small REST API (`POST /api/chat`, `GET /api/conversations/:id/messages`) that owns the model call and all persistence — the browser never talks to the model provider directly. Conversations and messages are stored in Postgres via Drizzle ORM, with Zod validating every model response against a strict schema before it's returned to the client.

**Model** — runs via Groq's low-latency inference API, using forced tool-calling so the model's output is structured JSON (answer + claims) rather than free-form prose. Scope enforcement runs both before and after the model call, so off-topic questions are declined without ever reaching the model, and off-topic model output is caught and declined even if the model drifts.

## Structure

- `frontend/` — Next.js app (deploy target: Vercel)
- `backend/` — Express + TypeScript API (deploy target: Railway)

## Local development

**Postgres**

Local dev uses [Postgres.app](https://postgresapp.com/) (installed under `/Applications/Postgres.app`, version 17). Start/stop the server with:

```bash
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
DATADIR=~/Library/Application\ Support/Postgres/var-17

# start
"$PGBIN/pg_ctl" -D "$DATADIR" -l "$DATADIR/logfile" -o "-p 5432 -k /tmp" start

# stop
"$PGBIN/pg_ctl" -D "$DATADIR" stop
```

The `ai_nutrition_assistant` database was created with `createdb`, and `backend/.env`'s `DATABASE_URL` already points at it (`postgresql://postgres@localhost:5432/ai_nutrition_assistant`).

**Backend**
```bash
cd backend
cp .env.example .env   # fill in GROQ_API_KEY and DATABASE_URL
npm install
npm run db:migrate
npm run dev             # http://localhost:4000
```

**Frontend**
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev              # http://localhost:3000
```

## Prompt regression testing

After any change to `backend/src/prompts/system.ts` or `backend/src/scope/guard.ts`, run:

```bash
cd backend
npm run eval
```

This replays the fixed question set in `src/evals/questions.json` and flags any question whose outcome flipped since the last run.
