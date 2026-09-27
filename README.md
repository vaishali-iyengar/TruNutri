# AI Nutrition Assistant

Prototype chatbot answering questions about food, nutrition, and food safety. See [problem-statement.md](problem-statement.md) for the brief and [architecture.md](architecture.md) for the full design.

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
