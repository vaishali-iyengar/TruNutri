import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ChatResponseSchema, type ChatResponse, type Claim } from "../schema/response.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const TOOL_NAME = "respond";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  claims?: Claim[]; // assistant turns only — lets history be replayed as a real tool call, not plain text
}

// zodToJsonSchema() emits a top-level "$schema" meta key, which is not part
// of a function-calling "parameters" object — leaving it in makes Groq's tool
// invocation unreliable (observed: the model sometimes ignores the forced
// tool_choice and replies in plain text instead, which Groq then rejects).
function toolParameters() {
  const { $schema: _drop, ...schema } = zodToJsonSchema(ChatResponseSchema) as Record<string, unknown>;
  return schema;
}

// Replaying a prior assistant turn as plain `{role: "assistant", content}`
// makes the conversation look, from the model's perspective, like an ordinary
// chat — inconsistent with tool_choice being forced on the *current* turn.
// That mismatch is the likely cause of the model sometimes replying in plain
// text (or nothing) on a follow-up turn, which Groq then rejects with
// "tool_use_failed". Reconstructing each prior assistant turn as the actual
// tool_call + tool-result pair the model would have produced keeps the
// tool-calling pattern consistent across the whole conversation.
function toGroqMessages(history: HistoryMessage[]): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM_PROMPT }];

  history.forEach((m, i) => {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
      return;
    }
    const toolCallId = `call_${i}`;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: TOOL_NAME,
            arguments: JSON.stringify({ answer: m.content, claims: m.claims ?? [] }),
          },
        },
      ],
    });
    messages.push({ role: "tool", tool_call_id: toolCallId, content: "ok" });
  });

  return messages;
}

// Even with consistent history, this model occasionally still ignores the
// forced tool_choice and returns nothing, which Groq rejects with a 400
// "tool_use_failed" (empty failed_generation). One retry with an explicit
// reminder appended as the most recent turn recovers most of these; if it
// fails twice, the caller still gets a clean error rather than a thrown
// exception.
const TOOL_USE_FAILED_CODE = "tool_use_failed";
const RETRY_NUDGE: HistoryMessage = {
  role: "user",
  content: "(Reminder: respond only by calling the respond tool with the required fields — do not reply in plain text.)",
};

function isToolUseFailed(err: unknown): boolean {
  const code = (err as { error?: { error?: { code?: string } } })?.error?.error?.code;
  return code === TOOL_USE_FAILED_CODE;
}

async function requestCompletion(history: HistoryMessage[]) {
  return groq.chat.completions.create({
    model: MODEL,
    messages: toGroqMessages(history),
    tools: [
      {
        type: "function",
        function: {
          name: TOOL_NAME,
          description: "Return the structured chat response.",
          parameters: toolParameters(),
        },
      },
    ],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  });
}

export async function callModel(history: HistoryMessage[]): Promise<{
  raw: unknown;
  parsed: ChatResponse | null;
  error: string | null;
}> {
  let response;
  try {
    response = await requestCompletion(history);
  } catch (err) {
    if (!isToolUseFailed(err)) throw err;
    response = await requestCompletion([...history, RETRY_NUDGE]);
  }

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") {
    return { raw: response.choices[0]?.message, parsed: null, error: "no_tool_call" };
  }

  let args: unknown;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { raw: toolCall.function.arguments, parsed: null, error: "invalid_tool_call_json" };
  }

  const result = ChatResponseSchema.safeParse(args);
  if (!result.success) {
    return { raw: args, parsed: null, error: result.error.message };
  }

  return { raw: args, parsed: result.data, error: null };
}
