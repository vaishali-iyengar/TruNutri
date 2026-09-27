import { z } from "zod";

export const ClaimSchema = z.object({
  text: z.string(),
  source: z.null(), // stays null until Milestone 2 wires up real sources
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  claims: z.array(ClaimSchema),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
