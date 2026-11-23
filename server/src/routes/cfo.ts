/**
 * AI CFO routes for Milestone 6.
 *
 *   GET  /briefing            -> AiCfoBriefing (deterministic facts, optional LLM wording)
 *   POST /briefing/scenario   -> AiCfoBriefing with scenario advice
 *                                body: { adjustments: ScenarioAdjustment[] } (max 10)
 *                                400 { error, issues } on validation failure
 *                                422 { error: "Unknown customerId: x" | "Unknown invoiceId: x" | "Unknown expenseId: x" }
 *   POST /chat                -> AiCfoChatResponse (deterministic answer, optional LLM wording)
 *                                body: AiCfoChatRequest; 400 { error, issues } on validation failure;
 *                                422 for unknown adjustment ids. Chat history is not stored.
 *
 * All routes reload the dataset on every request. None of them saves the dataset.
 * All calculation lives in ai/deterministic.ts; the LLM only rewords text (ai/cfoAdvisor.ts).
 */

import express from "express";
import type { Dataset, ScenarioAdjustment } from "../../../shared/types.js";
import { answerChat } from "../ai/chat.js";
import { briefingFromEnv, generateCfoBriefing } from "../ai/cfoAdvisor.js";
import { buildSeedDataset } from "../data/seed.js";
import type { DataRepository } from "../data/store.js";
import { chatRequestSchema } from "../validation/chatSchemas.js";
import { scenarioRequestSchema } from "../validation/forecastSchemas.js";
import { sendValidationError } from "./crmHelpers.js";

/**
 * Read-only load: uses the stored file when present; otherwise returns the in-memory seed without writing it
 * (same approach as forecast.ts, so these routes never save the dataset).
 */
function loadDatasetReadOnly(repo: DataRepository): Dataset {
  try {
    return repo.load();
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return buildSeedDataset();
    }
    throw err;
  }
}

/** First adjustment that references a customer, invoice or expense missing from the dataset. */
function findUnknownReference(dataset: Dataset, adjustments: ScenarioAdjustment[]): string | null {
  const customerIds = new Set(dataset.customers.map((customer) => customer.id));
  const invoiceIds = new Set(dataset.invoices.map((invoice) => invoice.id));
  const expenseIds = new Set(dataset.expenses.map((expense) => expense.id));

  for (const adjustment of adjustments) {
    switch (adjustment.type) {
      case "customer_delay":
      case "customer_partial_payment":
      case "customer_early_payment":
        if (!customerIds.has(adjustment.customerId)) return `Unknown customerId: ${adjustment.customerId}`;
        break;
      case "invoice_delay":
        if (!invoiceIds.has(adjustment.invoiceId)) return `Unknown invoiceId: ${adjustment.invoiceId}`;
        break;
      case "expense_increase":
      case "expense_postponement":
      case "rent_increase":
      case "supplier_payment_change":
        if (!expenseIds.has(adjustment.expenseId)) return `Unknown expenseId: ${adjustment.expenseId}`;
        break;
      case "new_expense":
        break;
    }
  }
  return null;
}

export function createCfoRouter(repo: DataRepository): express.Router {
  const router = express.Router();

  router.get("/briefing", async (_req, res) => {
    try {
      const briefing = await generateCfoBriefing(loadDatasetReadOnly(repo), { provider: briefingFromEnv() });
      res.json(briefing);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/briefing/scenario", async (req, res) => {
    try {
      const parsed = scenarioRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }

      const dataset = loadDatasetReadOnly(repo);
      const adjustments = parsed.data.adjustments;

      const unknown = findUnknownReference(dataset, adjustments);
      if (unknown !== null) {
        res.status(422).json({ error: unknown });
        return;
      }

      const briefing = await generateCfoBriefing(dataset, { adjustments, provider: briefingFromEnv() });
      res.json(briefing);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/chat", async (req, res) => {
    try {
      const parsed = chatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }

      const dataset = loadDatasetReadOnly(repo);
      const chatRequest = parsed.data;
      if (chatRequest.adjustments !== undefined) {
        const unknown = findUnknownReference(dataset, chatRequest.adjustments);
        if (unknown !== null) {
          res.status(422).json({ error: unknown });
          return;
        }
      }

      const answer = await answerChat(dataset, chatRequest, { provider: briefingFromEnv() });
      res.json(answer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
