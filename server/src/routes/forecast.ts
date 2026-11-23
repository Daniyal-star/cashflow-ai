/**
 * Milestone 4 cash-flow forecast routes.
 *
 *   GET  /api/forecast            -> ForecastResult (forecastCashFlow on the stored dataset)
 *   POST /api/forecast/scenario   -> ScenarioComparison (compareScenario on the stored dataset)
 *                                    body: { adjustments: ScenarioAdjustment[] } (max 10)
 *                                    400 { error, issues } on validation failure
 *                                    422 { error: "Unknown customerId: x" | "Unknown invoiceId: x" | "Unknown expenseId: x" }
 *
 * Both routes reload the dataset on every request. The scenario route is read-only: it never saves.
 * All calculation is delegated to forecastCashFlow / compareScenario.
 */

import type express from "express";
import type { Dataset, ScenarioAdjustment } from "../../../shared/types.js";
import { forecastCashFlow } from "../core/forecast.js";
import { compareScenario } from "../core/scenario.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import { buildSeedDataset } from "../data/seed.js";
import type { DataRepository } from "../data/store.js";
import { scenarioRequestSchema } from "../validation/forecastSchemas.js";
import { guard, sendValidationError } from "./crmHelpers.js";

/**
 * Read-only load for the scenario route. Uses the stored file when present; if the file does not exist yet,
 * returns the in-memory seed without writing it (unlike loadOrSeedDataset, which saves the seed).
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

/** First adjustment (in request order) that references a customer, invoice or expense missing from the dataset. */
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

export function registerForecastRoutes(app: express.Express, repo: DataRepository): void {
  app.get(
    "/api/forecast",
    guard((_req, res) => {
      res.json(forecastCashFlow(loadOrSeedDataset(repo)));
    }),
  );

  app.post(
    "/api/forecast/scenario",
    guard((req, res) => {
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

      res.json(compareScenario(dataset, adjustments));
    }),
  );
}
