/**
 * AI CFO orchestration: deterministic briefing first, optional LLM wording second.
 *
 * The LLM only replaces summary text, risk explanations and action details. Metrics, numbers,
 * ordering, urgency, impact and scenario advice always come from the deterministic briefing.
 */

import type { AiCfoBriefing, Dataset, ScenarioAdjustment } from "../../../shared/types.js";
import { buildDeterministicBriefing } from "./deterministic.js";
import { createProviderFromEnv, type LlmProvider } from "./llm.js";
import { validateAiOutput } from "./validate.js";

export interface BriefingOptions {
  adjustments?: ScenarioAdjustment[];
  provider?: LlmProvider | null;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = [
  "You are a finance explainer for a small business cash-flow dashboard.",
  "Use only the facts given in the user message.",
  "Do not calculate, estimate or invent any numbers, dates, customers or invoices.",
  "Copy every amount, date and name exactly as written in the facts, including the rupee symbol and digit grouping.",
  "Reword the summary, the risk explanations and the action details in clear plain English.",
  'Return only a JSON object of the form {"summary": string, "risks": [{"riskId": string, "explanation": string}], "actions": [{"id": string, "detail": string}]}.',
  "Cover only the riskIds and action ids that appear in the facts.",
].join(" ");

export async function generateCfoBriefing(dataset: Dataset, options: BriefingOptions = {}): Promise<AiCfoBriefing> {
  const base = buildDeterministicBriefing(dataset, options.adjustments);
  const provider = options.provider;
  if (provider === null || provider === undefined) {
    return base;
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("LLM provider timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });

  let raw: string;
  try {
    raw = await Promise.race([provider.complete(SYSTEM_PROMPT, JSON.stringify(base), controller.signal), timeout]);
  } catch {
    return { ...base, providerStatus: "unavailable" };
  } finally {
    clearTimeout(timer);
  }

  const validation = validateAiOutput(raw, base);
  if (!validation.ok) {
    return { ...base, providerStatus: "invalid_output" };
  }
  const { value } = validation;
  const explanations = new Map(value.risks.map((risk) => [risk.riskId, risk.explanation]));
  const details = new Map(value.actions.map((action) => [action.id, action.detail]));

  return {
    ...base,
    source: "ai",
    providerStatus: "ok",
    summary: value.summary,
    risks: base.risks.map((risk) => ({ ...risk, explanation: explanations.get(risk.riskId) ?? risk.explanation })),
    actions: base.actions.map((action) => ({ ...action, detail: details.get(action.id) ?? action.detail })),
  };
}

/** Provider from process.env, or null when CFO_AI_API_KEY is not set. */
export function briefingFromEnv(): LlmProvider | null {
  return createProviderFromEnv(process.env);
}
