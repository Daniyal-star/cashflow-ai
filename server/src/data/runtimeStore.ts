/**
 * Runtime dataset location and load-or-seed behaviour for the API server.
 */

import * as path from "node:path";
import type { Dataset } from "../../../shared/types.js";
import { buildSeedDataset } from "./seed.js";
import type { DataRepository } from "./store.js";

/**
 * Resolve the JSON data file: explicit override, then DATA_FILE, then server/data/cashflow.json under the working directory.
 */
export function resolveDataFile(override?: string): string {
  if (override !== undefined && override !== "") return override;
  if (process.env.DATA_FILE !== undefined && process.env.DATA_FILE !== "") return process.env.DATA_FILE;
  return path.resolve(process.cwd(), "server", "data", "cashflow.json");
}

/**
 * Load the dataset. If the file does not exist yet, write the deterministic seed dataset and use it.
 * Any other error (invalid JSON, schema failure, I/O) propagates unchanged.
 */
export function loadOrSeedDataset(repo: DataRepository): Dataset {
  try {
    return repo.load();
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      const seed = buildSeedDataset();
      repo.save(seed);
      return seed;
    }
    throw err;
  }
}
