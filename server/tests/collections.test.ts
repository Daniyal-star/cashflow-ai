import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Dataset, Invoice, Payment } from "../../shared/types.js";
import { buildCollectionsSummary } from "../src/core/collections.js";
import { createApp } from "../src/index.js";
import { buildSeedDataset } from "../src/data/seed.js";
import { createDataStore } from "../src/data/store.js";

const ASOF = "2025-06-15";

function dataset(invoices: Invoice[], payments: Payment[] = []): Dataset {
  return {
    settings: {
      openingBalance: 0,
      safetyBuffer: 0,
      asOfDate: ASOF,
      forecastHorizonDays: 30,
      defaultPaymentDelayDays: 10,
      overdueCollectionDelayDays: 14,
    },
    customers: [
      { id: "c1", name: "Alpha Traders", isDemoData: true },
      { id: "c2", name: "Beta Foods", isDemoData: true },
      { id: "c3", name: "Gamma Retail", isDemoData: true },
    ],
    invoices,
    payments,
    expenses: [],
  };
}

function inv(
  id: string,
  customerId: string,
  dueDate: string,
  amount: number,
  status: Invoice["status"] = "sent",
  extra: Partial<Invoice> = {},
): Invoice {
  return { id, invoiceNumber: id.toUpperCase(), customerId, issueDate: "2025-01-01", dueDate, amount, status, ...extra };
}

// Open balances: i1 1,000,000 (60 days overdue), i2 1,000,000 (5 days), i3 2,000,000 (30 days, 1,000,000 paid),
// i4 2,000,000 (not yet due). i5 is fully paid and i6 is cancelled, so both are excluded.
const HAND_INVOICES: Invoice[] = [
  inv("i1", "c1", "2025-04-16", 1_000_000),
  inv("i2", "c2", "2025-06-10", 1_000_000),
  inv("i3", "c2", "2025-05-16", 3_000_000, "partially_paid"),
  inv("i4", "c3", "2025-07-01", 2_000_000),
  inv("i5", "c3", "2025-05-01", 500_000, "paid"),
  inv("i6", "c1", "2025-05-01", 800_000, "cancelled", { cancelled: true }),
];
const HAND_PAYMENTS: Payment[] = [
  { id: "p1", invoiceId: "i3", date: "2025-06-01", amount: 1_000_000, isDemoData: true },
  { id: "p2", invoiceId: "i5", date: "2025-05-30", amount: 500_000, isDemoData: true },
];

describe("buildCollectionsSummary totals", () => {
  it("totals equal the sum of open balances and of overdue balances", () => {
    const summary = buildCollectionsSummary(dataset(HAND_INVOICES, HAND_PAYMENTS));
    expect(summary.totalOutstanding).toBe(6_000_000);
    expect(summary.totalOverdue).toBe(4_000_000);
    expect(summary.overdueInvoiceCount).toBe(3);
    expect(summary.queue).toHaveLength(3);
    expect(summary.queue.reduce((sum, q) => sum + q.balance, 0)).toBe(summary.totalOverdue);
    expect(summary.asOfDate).toBe(ASOF);
  });

  it("empty dataset returns an empty queue and zero totals without NaN", () => {
    const summary = buildCollectionsSummary(dataset([]));
    expect(summary.queue).toEqual([]);
    expect(summary.totalOutstanding).toBe(0);
    expect(summary.totalOverdue).toBe(0);
    expect(summary.overdueInvoiceCount).toBe(0);
    expect(summary.customersRequiringAttention).toBe(0);
    expect(summary.opportunityCount).toBe(0);
    expect(Number.isFinite(summary.totalOutstanding)).toBe(true);
  });

  it("excludes paid and cancelled invoices from the queue", () => {
    const summary = buildCollectionsSummary(dataset(HAND_INVOICES, HAND_PAYMENTS));
    const ids = summary.queue.map((q) => q.invoiceId);
    expect(ids).not.toContain("i5");
    expect(ids).not.toContain("i6");
    expect(ids).not.toContain("i4");
  });
});

describe("buildCollectionsSummary ranking", () => {
  it("an invoice 60 days overdue ranks above one 5 days overdue for the same amount", () => {
    const summary = buildCollectionsSummary(dataset(HAND_INVOICES, HAND_PAYMENTS));
    const old = summary.queue.find((q) => q.invoiceId === "i1")!;
    const recent = summary.queue.find((q) => q.invoiceId === "i2")!;
    expect(old.daysOverdue).toBe(60);
    expect(recent.daysOverdue).toBe(5);
    expect(old.amount).toBe(recent.amount);
    expect(old.priorityRank).toBeLessThan(recent.priorityRank);
  });

  it("a larger overdue balance with the same days ranks above a smaller one", () => {
    const summary = buildCollectionsSummary(
      dataset([inv("big", "c1", "2025-05-16", 3_000_000), inv("small", "c2", "2025-05-16", 1_000_000)]),
    );
    const big = summary.queue.find((q) => q.invoiceId === "big")!;
    const small = summary.queue.find((q) => q.invoiceId === "small")!;
    expect(big.daysOverdue).toBe(small.daysOverdue);
    expect(big.priorityRank).toBeLessThan(small.priorityRank);
  });

  it("ranks are 1..n and follow descending priority score order", () => {
    const summary = buildCollectionsSummary(dataset(HAND_INVOICES, HAND_PAYMENTS));
    expect(summary.queue.map((q) => q.priorityRank)).toEqual([1, 2, 3]);
    expect(summary.queue[0]!.invoiceId).toBe("i1");
  });
});

describe("buildCollectionsSummary item details", () => {
  it("a customer with no settled history has null reliability and the insufficient-history reason, with no NaN", () => {
    const summary = buildCollectionsSummary(dataset(HAND_INVOICES, HAND_PAYMENTS));
    const item = summary.queue.find((q) => q.invoiceId === "i1")!;
    expect(item.reliabilityScore).toBeNull();
    expect(item.reasons.some((r) => r.startsWith("Insufficient payment history"))).toBe(true);
    for (const reason of item.reasons) expect(reason).not.toContain("NaN");
    expect(item.reasons).toContain("60 days past due");
  });

  it("a partially paid overdue invoice has balance = amount - paid and overdueAmount = balance", () => {
    const summary = buildCollectionsSummary(dataset(HAND_INVOICES, HAND_PAYMENTS));
    const item = summary.queue.find((q) => q.invoiceId === "i3")!;
    expect(item.amount).toBe(3_000_000);
    expect(item.balance).toBe(2_000_000);
    expect(item.overdueAmount).toBe(item.balance);
    expect(item.daysOverdue).toBe(30);
  });

  it("is deterministic: two calls return deep-equal results", () => {
    const data = dataset(HAND_INVOICES, HAND_PAYMENTS);
    expect(buildCollectionsSummary(data)).toEqual(buildCollectionsSummary(data));
  });
});

describe("buildCollectionsSummary on the seed", () => {
  it("the only overdue seed invoice is INV-1047 for Sharma Textiles and it is the top item", () => {
    const summary = buildCollectionsSummary(buildSeedDataset());
    expect(summary.totalOutstanding).toBe(20_800_000);
    expect(summary.totalOverdue).toBe(1_000_000);
    expect(summary.queue).toHaveLength(1);
    expect(summary.queue[0]!.customerName).toBe("Sharma Textiles");
    expect(summary.queue[0]!.invoiceNumber).toBe("INV-1047");
    expect(summary.queue[0]!.priorityRank).toBe(1);
  });
});

const ALLOWED_PRIORITIES = ["critical", "high", "medium", "low"];

describe("GET /api/collections/summary", () => {
  let server: Server;
  let baseUrl: string;
  let dataFile: string;

  beforeEach(async () => {
    dataFile = path.join(os.tmpdir(), `collections-test-${randomUUID()}.json`);
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

  it("returns 200 with a queue array of allowed priorities", async () => {
    const res = await fetch(`${baseUrl}/api/collections/summary`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queue: Array<{ priority: string }>; totalOverdue: number };
    expect(Array.isArray(body.queue)).toBe(true);
    expect(body.totalOverdue).toBe(1_000_000);
    for (const row of body.queue) expect(ALLOWED_PRIORITIES).toContain(row.priority);
  });
});
