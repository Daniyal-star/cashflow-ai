import express from "express";
import { pathToFileURL } from "node:url";
import { resolveDataFile } from "./data/runtimeStore.js";
import { createDataStore } from "./data/store.js";
import { getDashboardPayload } from "./routes/dashboard.js";
import { registerCustomerRoutes } from "./routes/customers.js";
import { registerInvoiceRoutes } from "./routes/invoices.js";
import { registerForecastRoutes } from "./routes/forecast.js";
import { createIntelligenceRouter } from "./routes/intelligence.js";
import { createCfoRouter } from "./routes/cfo.js";
import { createCollectionsRouter } from "./routes/collections.js";
import { createRemindersRouter } from "./routes/reminders.js";

export interface CreateAppOptions {
  /** JSON data file path. Defaults to DATA_FILE, then server/data/cashflow.json. */
  dataFile?: string;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  app.use(express.json());

  const repo = createDataStore(resolveDataFile(options.dataFile));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", asOfDate: "2025-06-15" });
  });

  app.get("/api/dashboard", (_req, res) => {
    try {
      res.json(getDashboardPayload(repo));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  registerCustomerRoutes(app, repo);
  registerInvoiceRoutes(app, repo);
  registerForecastRoutes(app, repo);
  app.use("/api/intelligence", createIntelligenceRouter(repo));
  app.use("/api/cfo", createCfoRouter(repo));
  app.use("/api/collections", createCollectionsRouter(repo));
  app.use("/api/reminders", createRemindersRouter(repo));

  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => {
    console.log(`CASHFLOW AI API listening on http://localhost:${port}`);
  });
}
