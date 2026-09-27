import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { validate as isValidUuid } from "uuid";
import { db } from "../db/client.js";
import { conversations, messages, failures } from "../db/schema.js";
import { checkScope, DECLINE_MESSAGE } from "../scope/guard.js";
import { callModel, type HistoryMessage } from "../model/client.js";

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res, next) => {
  try {
    await handleChat(req.body, res);
  } catch (err) {
    next(err);
  }
});

async function handleChat(
  body: { conversationId: string | null; message: string },
  res: import("express").Response,
) {
  const { conversationId, message } = body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  if (conversationId != null && !isValidUuid(conversationId)) {
    return res.status(400).json({ error: "conversationId must be a valid UUID or null" });
  }

  // Ensure a conversation exists.
  let convId = conversationId;
  if (!convId) {
    const [created] = await db.insert(conversations).values({}).returning();
    convId = created.id;
  } else {
    const [existing] = await db.select().from(conversations).where(eq(conversations.id, convId));
    if (!existing) {
      return res.status(404).json({ error: "conversationId not found" });
    }
  }

  // Pre-model scope check.
  const preCategory = checkScope(message);
  if (preCategory) {
    await db.insert(failures).values({
      conversationId: convId,
      kind: "scope_violation",
      rawOutput: message,
      detail: { category: preCategory, stage: "pre_model" },
    });
    await db.insert(messages).values([
      { conversationId: convId, role: "user", content: message, claims: [] },
      { conversationId: convId, role: "assistant", content: DECLINE_MESSAGE, claims: [] },
    ]);
    return res.json({
      conversationId: convId,
      answer: DECLINE_MESSAGE,
      claims: [],
      declined: true,
      reason: preCategory,
    });
  }

  // Load prior history for model context.
  const priorMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(asc(messages.createdAt));

  const history: HistoryMessage[] = [
    ...priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      claims: (m.claims as HistoryMessage["claims"]) ?? [],
    })),
    { role: "user", content: message },
  ];

  let raw: unknown;
  let parsed: Awaited<ReturnType<typeof callModel>>["parsed"];
  let error: string | null;
  try {
    ({ raw, parsed, error } = await callModel(history));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(failures).values({
      conversationId: convId,
      kind: "model_error",
      rawOutput: null,
      detail: { error: message },
    });
    return res.status(502).json({
      conversationId: convId,
      error: "The model call failed. This has been recorded.",
    });
  }

  if (!parsed) {
    await db.insert(failures).values({
      conversationId: convId,
      kind: "schema_validation",
      rawOutput: JSON.stringify(raw),
      detail: { error },
    });
    return res.status(502).json({
      conversationId: convId,
      error: "The model response could not be validated. This has been recorded.",
    });
  }

  // Post-model scope check on the generated answer.
  const postCategory = checkScope(parsed.answer);
  if (postCategory) {
    await db.insert(failures).values({
      conversationId: convId,
      kind: "scope_violation",
      rawOutput: parsed.answer,
      detail: { category: postCategory, stage: "post_model" },
    });
    await db.insert(messages).values([
      { conversationId: convId, role: "user", content: message, claims: [] },
      { conversationId: convId, role: "assistant", content: DECLINE_MESSAGE, claims: [] },
    ]);
    return res.json({
      conversationId: convId,
      answer: DECLINE_MESSAGE,
      claims: [],
      declined: true,
      reason: postCategory,
    });
  }

  await db.insert(messages).values([
    { conversationId: convId, role: "user", content: message, claims: [] },
    { conversationId: convId, role: "assistant", content: parsed.answer, claims: parsed.claims },
  ]);

  return res.json({
    conversationId: convId,
    answer: parsed.answer,
    claims: parsed.claims,
  });
}
