import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type {
  Customer,
  Dataset,
  Expense,
  ForecastDay,
  ForecastResult,
  Invoice,
  Payment,
  ScenarioAdjustment,
  Settings,
} from "../../shared/types.js";
import { createApp } from "../src/index.js";
import { buildSeedDataset } from "../src/data/seed.js";
import { createDataStore } from "../src/data/store.js";
import { forecastCashFlow } from "../src/core/forecast.js";
import { compareScenario } from "../src/core/scenario.js";

// ---------- fixtures and helpers ----------

const AS_OF = "2025-06-15";
const CUSTOMERS: Customer[] = [
  { id: "c-a", name: "Alpha Traders", isDemoData: true },
  { id: "c-b", name: "Beta Mills", isDemoData: true },
];

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    openingBalance: 0,
    safetyBuffer: 0,
    asOfDate: AS_OF,
    forecastHorizonDays: 30,
    defaultPaymentDelayDays: 10,
    overdueCollectionDelayDays: 14,
    ...overrides,
  };
}

function makeDataset(parts: {
  settings?: Partial<Settings>;
  invoices?: Invoice[];
  payments?: Payment[];
  expenses?: Expense[];
}): Dataset {
  return {
    settings: makeSettings(parts.settings),
    customers: CUSTOMERS,
    invoices: parts.invoices ?? [],
    payments: parts.payments ?? [],
    expenses: parts.expenses ?? [],
  };
}

function invoice(id: string, customerId: string, amount: number, dueDate: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    invoiceNumber: `T-${id}`,
    customerId,
    issueDate: "2025-05-01",
    dueDate,
    amount,
    status: "sent",
    ...overrides,
  };
}

function expense(id: string, amount: number, dueDate: string): Expense {
  return { id, name: `Expense ${id}`, category: "test", amount, dueDate, recurrence: "none", isDemoData: true };
}

function payment(id: string, invoiceId: string, amount: number, date: string): Payment {
  return { id, invoiceId, amount, date, isDemoData: true };
}

function dayOn(forecast: ForecastResult, date: string): ForecastDay {
  const day = forecast.days.find((d) => d.date === date);
  if (day === undefined) throw new Error(`no forecast day ${date}`);
  return day;
}

const incomingTotal = (forecast: ForecastResult): number =>
  forecast.days.reduce((sum, day) => sum + day.incoming, 0);

const adjustDelay = (invoiceId: string, days: number): ScenarioAdjustment[] => [
  { type: "invoice_delay", invoiceId, days },
];

// Adjustments used by the seed-based tests (both ids exist in buildSeedDataset()).
const SEED_ADJUSTMENTS: ScenarioAdjustment[] = [
  { type: "invoice_delay", invoiceId: "inv-1049", days: 15 },
  { type: "customer_delay", customerId: "cust-sharma", days: 7 },
];

// ---------- A. Forecast accuracy (direct engine calls) ----------

describe("A. forecast accuracy", () => {
  it("an open invoice due 2025-06-20 is collected on 2025-06-30 (due + 10) and balance rises by 5000000", () => {
    const f = forecastCashFlow(makeDataset({ invoices: [invoice("inv-open", "c-a", 5_000_000, "2025-06-20")] }));
    expect(dayOn(f, "2025-06-30").incoming).toBe(5_000_000);
    expect(dayOn(f, "2025-06-29").incoming).toBe(0);
    expect(dayOn(f, "2025-06-29").balance).toBe(0);
    expect(dayOn(f, "2025-06-30").balance).toBe(5_000_000);
    expect(incomingTotal(f)).toBe(5_000_000);
  });

  it("an overdue invoice due 2025-06-01 unpaid is collected on 2025-06-29 (as-of + 14)", () => {
    const f = forecastCashFlow(
      makeDataset({ invoices: [invoice("inv-od", "c-a", 3_000_000, "2025-06-01", { status: "overdue" })] }),
    );
    expect(dayOn(f, "2025-06-29").incoming).toBe(3_000_000);
    expect(dayOn(f, "2025-06-30").incoming).toBe(0);
    expect(incomingTotal(f)).toBe(3_000_000);
  });

  it("a partial payment of 4000000 dated 2025-06-05 leaves 6000000 collected on the expected date 2025-06-30", () => {
    const f = forecastCashFlow(
      makeDataset({
        invoices: [invoice("inv-p", "c-a", 10_000_000, "2025-06-20", { status: "partially_paid" })],
        payments: [payment("p1", "inv-p", 4_000_000, "2025-06-05")],
      }),
    );
    expect(dayOn(f, "2025-06-30").incoming).toBe(6_000_000);
    expect(incomingTotal(f)).toBe(6_000_000);
  });

  it("a payment dated after the as-of date (2025-06-20) is ignored: the full amount is still collected", () => {
    const f = forecastCashFlow(
      makeDataset({
        invoices: [invoice("inv-f", "c-a", 10_000_000, "2025-06-20")],
        payments: [payment("p-future", "inv-f", 4_000_000, "2025-06-20")],
      }),
    );
    expect(dayOn(f, "2025-06-30").incoming).toBe(10_000_000);
    expect(incomingTotal(f)).toBe(10_000_000);
  });

  it("cancelled invoices (flag or status) contribute nothing", () => {
    const f = forecastCashFlow(
      makeDataset({
        invoices: [
          invoice("inv-c1", "c-a", 5_000_000, "2025-06-20", { cancelled: true }),
          invoice("inv-c2", "c-a", 2_000_000, "2025-06-20", { status: "cancelled" }),
        ],
      }),
    );
    expect(incomingTotal(f)).toBe(0);
    expect(f.minimumBalance).toBe(0);
  });

  it("minimumBalance is the min over the day balances and minimumBalanceDate is the first day reaching it; shortageDate is the first negative day", () => {
    // Opening 0. Balances: 06-22..06-26 = -3000000; 06-27..06-29 = -4000000; 06-30 = -3000000; 07-01 on = -4000000.
    const f = forecastCashFlow(
      makeDataset({
        invoices: [invoice("r", "c-a", 1_000_000, "2025-06-20")],
        expenses: [
          expense("x", 3_000_000, "2025-06-22"),
          expense("y", 1_000_000, "2025-06-27"),
          expense("z", 1_000_000, "2025-07-01"),
        ],
      }),
    );
    expect(f.minimumBalance).toBe(-4_000_000);
    expect(f.minimumBalance).toBe(Math.min(...f.days.map((d) => d.balance)));
    expect(f.minimumBalanceDate).toBe("2025-06-27");
    expect(f.shortageDate).toBe("2025-06-22");
    expect(f.shortageAmount).toBe(4_000_000);
    expect(f.cashRunwayDays).toBe(7);
    expect(dayOn(f, "2025-06-26").balance).toBe(-3_000_000);
    expect(dayOn(f, "2025-06-30").balance).toBe(-3_000_000);
  });

  it("shortageDate is null and the minimum is the opening balance when cash never goes negative", () => {
    const f = forecastCashFlow(
      makeDataset({
        settings: { openingBalance: 10_000_000 },
        invoices: [invoice("inv-ok", "c-a", 5_000_000, "2025-06-20")],
      }),
    );
    expect(f.shortageDate).toBeNull();
    expect(f.shortageAmount).toBe(0);
    expect(f.minimumBalance).toBe(10_000_000);
    expect(f.minimumBalanceDate).toBe("2025-06-16");
    expect(f.cashRunwayDays).toBe(30);
  });
});

// ---------- B. Delayed payments ----------

describe("B. delayed payments", () => {
  const openDataset = () => makeDataset({ invoices: [invoice("inv-open", "c-a", 5_000_000, "2025-06-20")] });

  it("invoice_delay of 15 days moves collection from 2025-06-30 to 2025-07-15", () => {
    const f = forecastCashFlow(openDataset(), { adjustments: adjustDelay("inv-open", 15) });
    expect(dayOn(f, "2025-06-30").incoming).toBe(0);
    expect(dayOn(f, "2025-07-14").balance).toBe(0);
    expect(dayOn(f, "2025-07-15").incoming).toBe(5_000_000);
    expect(dayOn(f, "2025-07-15").balance).toBe(5_000_000);
    expect(incomingTotal(f)).toBe(5_000_000);
  });

  it("invoice_delay pushing collection beyond the horizon removes the amount from all 30 days and warns", () => {
    // 2025-06-30 + 20 = 2025-07-20, after horizon end 2025-07-15.
    const baseline = forecastCashFlow(openDataset());
    const f = forecastCashFlow(openDataset(), { adjustments: adjustDelay("inv-open", 20) });
    expect(incomingTotal(f)).toBe(incomingTotal(baseline) - 5_000_000);
    expect(incomingTotal(f)).toBe(0);
    expect(f.days.length).toBe(30);
    expect(f.warnings.some((w) => w.includes("beyond the forecast horizon"))).toBe(true);
  });

  it("invoice_delay of 0 days gives the same days, balances, shortage and warnings as the seed baseline", () => {
    const seed = buildSeedDataset();
    const baseline = forecastCashFlow(seed);
    const f = forecastCashFlow(seed, { adjustments: adjustDelay("inv-1049", 0) });
    expect(f.days).toEqual(baseline.days);
    expect(f.minimumBalance).toBe(baseline.minimumBalance);
    expect(f.minimumBalanceDate).toBe(baseline.minimumBalanceDate);
    expect(f.shortageDate).toBe(baseline.shortageDate);
    expect(f.cashRunwayDays).toBe(baseline.cashRunwayDays);
    expect(f.warnings).toEqual(baseline.warnings);
  });

  it("invoice_delay on a partially paid invoice shifts only the remaining 6000000", () => {
    const ds = makeDataset({
      invoices: [invoice("inv-p", "c-a", 10_000_000, "2025-06-20", { status: "partially_paid" })],
      payments: [payment("p1", "inv-p", 4_000_000, "2025-06-05")],
    });
    const f = forecastCashFlow(ds, { adjustments: adjustDelay("inv-p", 15) });
    expect(dayOn(f, "2025-06-30").incoming).toBe(0);
    expect(dayOn(f, "2025-07-15").incoming).toBe(6_000_000);
    expect(incomingTotal(f)).toBe(6_000_000);
  });

  it("an unknown invoiceId leaves every day balance equal to baseline and adds exactly one warning", () => {
    const baseline = forecastCashFlow(openDataset());
    const f = forecastCashFlow(openDataset(), { adjustments: adjustDelay("missing-inv", 15) });
    expect(f.days).toEqual(baseline.days);
    expect(f.warnings).toEqual([...baseline.warnings, "Scenario invoice_delay ignored: unknown invoice missing-inv"]);
  });

  it("customer_delay of 7 days shifts all of that customer's open invoices and leaves other customers alone", () => {
    const ds = makeDataset({
      invoices: [
        invoice("inv-a1", "c-a", 5_000_000, "2025-06-20"), // expected 06-30 -> 07-07
        invoice("inv-a2", "c-a", 2_000_000, "2025-06-01", { status: "overdue" }), // expected 06-29 -> 07-06
        invoice("inv-b1", "c-b", 1_000_000, "2025-06-20"), // expected 06-30, unchanged
      ],
    });
    const baseline = forecastCashFlow(ds);
    expect(dayOn(baseline, "2025-06-29").incoming).toBe(2_000_000);
    expect(dayOn(baseline, "2025-06-30").incoming).toBe(6_000_000);

    const f = forecastCashFlow(ds, { adjustments: [{ type: "customer_delay", customerId: "c-a", days: 7 }] });
    expect(dayOn(f, "2025-06-29").incoming).toBe(0);
    expect(dayOn(f, "2025-06-30").incoming).toBe(1_000_000);
    expect(dayOn(f, "2025-07-06").incoming).toBe(2_000_000);
    expect(dayOn(f, "2025-07-07").incoming).toBe(5_000_000);
    expect(incomingTotal(f)).toBe(incomingTotal(baseline));
  });
});

// ---------- C. Scenario isolation and engine consistency (engine level) ----------

describe("C. scenario isolation and engine consistency", () => {
  it("compareScenario with no adjustments gives balanceDifference 0 and minimumBalanceDifference 0", () => {
    const cmp = compareScenario(buildSeedDataset(), []);
    expect(cmp.balanceDifference).toBe(0);
    expect(cmp.minimumBalanceDifference).toBe(0);
  });

  it("compareScenario().baseline deep-equals forecastCashFlow(seed)", () => {
    const seed = buildSeedDataset();
    const cmp = compareScenario(seed, SEED_ADJUSTMENTS);
    expect(cmp.baseline).toEqual(forecastCashFlow(seed));
  });

  it("compareScenario().scenario deep-equals forecastCashFlow(seed, { adjustments })", () => {
    const seed = buildSeedDataset();
    const cmp = compareScenario(seed, SEED_ADJUSTMENTS);
    expect(cmp.scenario).toEqual(forecastCashFlow(seed, { adjustments: SEED_ADJUSTMENTS }));
  });

  it("the dataset object is deep-equal before and after compareScenario", () => {
    const seed = buildSeedDataset();
    const snapshot = JSON.parse(JSON.stringify(seed));
    compareScenario(seed, SEED_ADJUSTMENTS);
    expect(seed).toEqual(snapshot);
  });
});

// ---------- D. HTTP routes ----------

interface ApiResult {
  status: number;
  body: any;
}

let server: Server;
let baseUrl: string;
let dataFile: string;

async function call(method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

describe("D. HTTP routes", () => {
  beforeEach(async () => {
    dataFile = path.join(os.tmpdir(), `forecast-scenario-test-${randomUUID()}.json`);
    createDataStore(dataFile).save(buildSeedDataset());
    const app = createApp({ dataFile });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(dataFile, { force: true });
  });

  it("GET /api/forecast returns 200 with 30 days and the seed baseline minimumBalance", async () => {
    const res = await call("GET", "/api/forecast");
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBe(30);
    expect(res.body.minimumBalance).toBe(forecastCashFlow(buildSeedDataset()).minimumBalance);
  });

  it("POST /api/forecast/scenario with an invoice_delay returns 200 with baseline and scenario keys", async () => {
    const res = await call("POST", "/api/forecast/scenario", {
      adjustments: [{ type: "invoice_delay", invoiceId: "inv-1049", days: 15 }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("baseline");
    expect(res.body).toHaveProperty("scenario");
  });

  it("POST with an unknown invoiceId returns 422 containing 'Unknown invoiceId'", async () => {
    const res = await call("POST", "/api/forecast/scenario", { adjustments: adjustDelay("inv-nope", 3) });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("Unknown invoiceId");
  });

  it("POST with an unknown customerId returns 422 containing 'Unknown customerId'", async () => {
    const res = await call("POST", "/api/forecast/scenario", {
      adjustments: [{ type: "customer_delay", customerId: "cust-nope", days: 3 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("Unknown customerId");
  });

  it("POST with days 1000 returns 400", async () => {
    const res = await call("POST", "/api/forecast/scenario", { adjustments: adjustDelay("inv-1049", 1000) });
    expect(res.status).toBe(400);
  });

  it("POST with 11 adjustments returns 400", async () => {
    const adjustments = Array.from({ length: 11 }, () => ({ type: "invoice_delay", invoiceId: "inv-1049", days: 1 }));
    const res = await call("POST", "/api/forecast/scenario", { adjustments });
    expect(res.status).toBe(400);
  });

  it("POST with an unknown adjustment type returns 400", async () => {
    const res = await call("POST", "/api/forecast/scenario", {
      adjustments: [{ type: "bogus", invoiceId: "inv-1049", days: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("POST does not modify the stored data file (bytes identical before and after)", async () => {
    const before = fs.readFileSync(dataFile);
    const res = await call("POST", "/api/forecast/scenario", { adjustments: SEED_ADJUSTMENTS });
    expect(res.status).toBe(200);
    const after = fs.readFileSync(dataFile);
    expect(after.equals(before)).toBe(true);
  });

  it("POST does not modify the in-memory seed object (snapshot deep-equal before and after the POST)", async () => {
    const seed = buildSeedDataset();
    const snapshot = JSON.parse(JSON.stringify(seed));
    compareScenario(seed, SEED_ADJUSTMENTS);
    const res = await call("POST", "/api/forecast/scenario", { adjustments: SEED_ADJUSTMENTS });
    expect(res.status).toBe(200);
    expect(seed).toEqual(snapshot);
  });

  it("reset semantics: POST with adjustments [] returns balanceDifference 0", async () => {
    const res = await call("POST", "/api/forecast/scenario", { adjustments: [] });
    expect(res.status).toBe(200);
    expect(res.body.balanceDifference).toBe(0);
    expect(res.body.minimumBalanceDifference).toBe(0);
  });
});

// ---------- E. Edge cases ----------

describe("E. edge cases", () => {
  it("zero opening balance with a delayed payment: nothing before the delayed day, full amount after it", () => {
    const ds = makeDataset({
      settings: { openingBalance: 0 },
      invoices: [invoice("inv-z", "c-a", 5_000_000, "2025-06-20")],
    });
    const f = forecastCashFlow(ds, { adjustments: adjustDelay("inv-z", 15) });
    expect(dayOn(f, "2025-06-30").balance).toBe(0);
    expect(dayOn(f, "2025-07-15").balance).toBe(5_000_000);
    expect(f.shortageDate).toBeNull();
  });

  it("negative opening balance with a delayed payment: shortage from day one, recovered on the delayed day", () => {
    const ds = makeDataset({
      settings: { openingBalance: -2_000_000 },
      invoices: [invoice("inv-n", "c-a", 5_000_000, "2025-06-20")],
    });
    const f = forecastCashFlow(ds, { adjustments: adjustDelay("inv-n", 15) });
    expect(dayOn(f, "2025-06-30").balance).toBe(-2_000_000);
    expect(dayOn(f, "2025-07-15").balance).toBe(3_000_000);
    expect(f.minimumBalance).toBe(-2_000_000);
    expect(f.minimumBalanceDate).toBe("2025-06-16");
    expect(f.shortageDate).toBe("2025-06-16");
    expect(f.shortageAmount).toBe(2_000_000);
    expect(f.cashRunwayDays).toBe(1);
  });

  it("empty invoices and expenses arrays give flat balances at the opening amount, and a scenario still runs", () => {
    const ds = makeDataset({ settings: { openingBalance: 1_000_000 } });
    const f = forecastCashFlow(ds);
    expect(f.days.length).toBe(30);
    expect(f.days.every((d) => d.incoming === 0 && d.outgoing === 0 && d.balance === 1_000_000)).toBe(true);
    expect(f.minimumBalance).toBe(1_000_000);

    const cmp = compareScenario(ds, adjustDelay("missing-inv", 5));
    expect(cmp.balanceDifference).toBe(0);
  });

  it("horizon 30 always yields exactly 30 days, from 2025-06-16 to 2025-07-15", () => {
    const datasets: Dataset[] = [
      buildSeedDataset(),
      makeDataset({}),
      makeDataset({ invoices: [invoice("inv-h", "c-a", 5_000_000, "2025-06-20")] }),
    ];
    for (const ds of datasets) {
      const f = forecastCashFlow(ds, { adjustments: adjustDelay("inv-h", 3) });
      expect(f.days.length).toBe(30);
      expect(f.horizonDays).toBe(30);
      expect(f.days[0].date).toBe("2025-06-16");
      expect(f.days[29].date).toBe("2025-07-15");
    }
  });
});
