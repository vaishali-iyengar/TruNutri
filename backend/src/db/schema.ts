import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  claims: jsonb("claims").notNull().default([]), // [{ text, source }]
  kind: text("kind").notNull().default("normal"), // 'normal' | 'declined' — lets reloaded history show the decline badge
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const failures = pgTable("failures", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  kind: text("kind").notNull(), // 'schema_validation' | 'scope_violation' | 'model_error'
  rawOutput: text("raw_output"),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
