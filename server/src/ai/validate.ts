/**
 * Validation of raw LLM output for the AI CFO.
 *
 * The model may only reword text. Every risk and action id must already exist in the briefing,
 * and every figure in the AI text must already appear in the briefing (the number guard).
 */

import { z } from "zod";
import type { AiCfoBriefing } from "../../../shared/types.js";

export const aiOutputSchema = z.object({
  summary: z.string().min(1).max(800),
  risks: z
    .array(z.object({ riskId: z.string(), explanation: z.string().min(1).max(400) }))
    .max(20),
  actions: z.array(z.object({ id: z.string(), detail: z.string().min(1).max(400) })).max(20),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;

export type AiOutputValidation = { ok: true; value: AiOutput } | { ok: false; reason: string };

const DIGITS = /\d+/g;

/** Every numeric token in `text`, after commas are removed (so "₹40,000" and "40000" both yield 40000). */
function numericTokens(text: string): string[] {
  return Array.from(text.replace(/,/g, "").matchAll(DIGITS), (match) => match[0]);
}

export function validateAiOutput(raw: string, briefing: AiCfoBriefing): AiOutputValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not JSON" };
  }

  const result = aiOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue !== undefined ? issue.path.join(".") || "(root)" : "(root)";
    return { ok: false, reason: `schema mismatch at ${where}` };
  }
  const value = result.data;

  const riskIds = new Set(briefing.risks.map((risk) => risk.riskId));
  const actionIds = new Set(briefing.actions.map((action) => action.id));
  if (value.risks.some((risk) => !riskIds.has(risk.riskId))) {
    return { ok: false, reason: "unknown id" };
  }
  if (value.actions.some((action) => !actionIds.has(action.id))) {
    return { ok: false, reason: "unknown id" };
  }

  // Number guard: every figure in the AI text must already appear in the briefing.
  const allowed = new Set<number>(numericTokens(JSON.stringify(briefing)).map(Number));
  const texts = [value.summary, ...value.risks.map((risk) => risk.explanation), ...value.actions.map((action) => action.detail)];
  for (const text of texts) {
    for (const token of numericTokens(text)) {
      if (!allowed.has(Number(token))) {
        return { ok: false, reason: `invented figure: ${token}` };
      }
    }
  }

  return { ok: true, value };
}
