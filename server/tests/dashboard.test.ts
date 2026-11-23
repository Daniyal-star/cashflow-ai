import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSeedDataset } from "../src/data/seed.js";
import { createDataStore } from "../src/data/store.js";
import { openReceivables } from "../src/core/receivables.js";
import { buildDashboardPayload, getDashboardPayload } from "../src/routes/dashboard.js";

describe("buildDashboardPayload on the seed dataset", () => {
  it("sets availableCash to the opening balance", () => {
    const seed = buildSeedDataset();
    const payload = buildDashboardPayload(seed);
    expect(payload.kpis.availableCash).toBe(seed.settings.openingBalance);
  });

  it("sets upcomingExpenses to the sum of forecast outgoing", () => {
    const payload = buildDashboardPayload(buildSeedDataset());
    const sum = payload.forecast.days.reduce((total, day) => total + day.outgoing, 0);
    expect(payload.kpis.upcomingExpenses).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });

  it("sets projectedMinimumBalance to forecast.minimumBalance", () => {
    const payload = buildDashboardPayload(buildSeedDataset());
    expect(payload.kpis.projectedMinimumBalance).toBe(payload.forecast.minimumBalance);
  });

  it("sets outstandingReceivables to the sum of open receivable remainders", () => {
    const seed = buildSeedDataset();
    const payload = buildDashboardPayload(seed);
    const sum = openReceivables(seed, seed.settings.asOfDate).reduce((total, item) => total + item.remaining, 0);
    expect(payload.kpis.outstandingReceivables).toBe(sum);
  });

  it("sorts collectionPriorities by overdueAmount desc, then outstanding desc, then customerId asc", () => {
    const payload = buildDashboardPayload(buildSeedDataset());
    const list = payload.collectionPriorities;
    expect(list.length).toBeGreaterThan(1);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      expect(prev.outstanding).toBeGreaterThan(0);
      if (prev.overdueAmount !== curr.overdueAmount) {
        expect(prev.overdueAmount).toBeGreaterThan(curr.overdueAmount);
      } else if (prev.outstanding !== curr.outstanding) {
        expect(prev.outstanding).toBeGreaterThan(curr.outstanding);
      } else {
        expect(prev.customerId < curr.customerId).toBe(true);
      }
    }
  });

  it("yields an empty collectionPriorities array when there are no open receivables", () => {
    const seed = buildSeedDataset();
    const payload = buildDashboardPayload({ ...seed, invoices: [], payments: [] });
    expect(payload.collectionPriorities).toEqual([]);
    expect(payload.kpis.outstandingReceivables).toBe(0);
    expect(payload.kpis.overdueReceivables).toBe(0);
  });
});

describe("getDashboardPayload with a data file", () => {
  it("seeds a missing data file on first load and reads it back", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-dashboard-"));
    const dataFile = path.join(tmpDir, "cashflow.json");
    try {
      const repo = createDataStore(dataFile);
      const payload = getDashboardPayload(repo);
      expect(fs.existsSync(dataFile)).toBe(true);
      expect(payload.kpis.availableCash).toBe(buildSeedDataset().settings.openingBalance);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
