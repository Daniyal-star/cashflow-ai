/**
 * Customer intelligence routes for Milestone 5.
 *
 *   GET /customers       -> CustomerIntelligence[]
 *   GET /customers/:id   -> CustomerIntelligence | 404 { error: "Customer not found" }
 *
 * Every request reloads the dataset, so results always reflect the latest recorded payments.
 * All scoring logic lives in core/customerIntelligence.ts; this module only loads and serves.
 */

import express from "express";
import type { CustomerIntelligence } from "../../../shared/types.js";
import { computeCustomerIntelligence, customerIntelligenceFor } from "../core/customerIntelligence.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";

export function createIntelligenceRouter(repo: DataRepository): express.Router {
  const router = express.Router();

  router.get("/customers", (_req, res) => {
    try {
      const rows: CustomerIntelligence[] = computeCustomerIntelligence(loadOrSeedDataset(repo));
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/customers/:id", (req, res) => {
    try {
      const id = req.params.id as string;
      const row = customerIntelligenceFor(loadOrSeedDataset(repo), id);
      if (!row) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
