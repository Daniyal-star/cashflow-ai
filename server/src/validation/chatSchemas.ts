/**
 * Zod schema for Milestone 6.1 AI CFO chat requests (POST /api/cfo/chat).
 *
 * Limits mirror server/src/ai/chat.ts (CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_HISTORY).
 * Existence of customerId / invoiceId / expenseId is NOT checked here; the route does that against the dataset.
 */

import { z } from "zod";
import { adjustmentSchema } from "./forecastSchemas.js";

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(1200),
      }),
    )
    .max(10)
    .optional(),
  adjustments: z.array(adjustmentSchema).max(10).optional(),
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
