/**
 * Zod schemas for Milestone 7.1 payment reminder requests.
 *
 * Both schemas use the default z.object behaviour, so unknown keys are stripped.
 */

import { z } from "zod";

const reminderTone = z.enum(["friendly", "professional", "firm"]);

export const draftRequestSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  tone: reminderTone,
  senderName: z.string().trim().min(1, "Sender name must not be empty").max(80, "Sender name must be at most 80 characters").optional(),
});

export const markSentRequestSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  tone: reminderTone,
  channels: z.array(z.enum(["whatsapp", "email"])).min(1, "At least one channel is required"),
  force: z.boolean().optional(),
});
