/**
 * Smart collections routes for Milestone 7.
 *
 *   GET /summary -> CollectionsSummary
 *
 * Every request reloads the dataset. All logic lives in core/collections.ts; this module only loads and serves.
 */

import express from "express";
import type { CollectionsSummary } from "../../../shared/types.js";
import { buildCollectionsSummary } from "../core/collections.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";

export function createCollectionsRouter(repo: DataRepository): express.Router {
  const router = express.Router();

  router.get("/summary", (_req, res) => {
    try {
      const summary: CollectionsSummary = buildCollectionsSummary(loadOrSeedDataset(repo));
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
