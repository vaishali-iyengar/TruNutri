import "dotenv/config";
import express from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  }),
);
app.use(express.json());

// express.json() throws a SyntaxError for malformed JSON bodies before any
// route handler runs; without this it falls through to Express's default
// HTML error page instead of a JSON error the frontend can parse.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  next(err);
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", chatRouter);

// Last-resort handler: anything a route passed to next(err) — e.g. an
// unexpected DB error — lands here instead of crashing the process.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
