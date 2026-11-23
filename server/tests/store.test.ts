import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Dataset } from "../../shared/types.js";
import { buildSeedDataset } from "../src/data/seed.js";
import { JsonDataStore } from "../src/data/store.js";

const createdFiles: string[] = [];

function uniqueTempFile(): string {
  const file = path.join(os.tmpdir(), `cashflow-store-test-${randomUUID()}.json`);
  createdFiles.push(file);
  return file;
}

afterEach(() => {
  for (const file of createdFiles.splice(0)) {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.tmp`, { force: true });
  }
});

describe("JsonDataStore", () => {
  it("round-trips the seed dataset through save() and load()", () => {
    const file = uniqueTempFile();
    const store = new JsonDataStore(file);
    const seed = buildSeedDataset();
    store.save(seed);
    expect(store.load()).toEqual(seed);
  });

  it("throws an Error whose message includes 'not found' when the file is missing", () => {
    const file = uniqueTempFile();
    const store = new JsonDataStore(file);
    expect(() => store.load()).toThrow(Error);
    expect(() => store.load()).toThrow(/not found/);
  });

  it("throws when saving a dataset with a non-integer invoice amount", () => {
    const file = uniqueTempFile();
    const store = new JsonDataStore(file);
    const seed = buildSeedDataset();
    const bad: Dataset = {
      ...seed,
      invoices: seed.invoices.map((invoice, index) => (index === 0 ? { ...invoice, amount: 12.5 } : invoice)),
    };
    expect(() => store.save(bad)).toThrow();
  });
});

describe("seed dataset internal consistency", () => {
  it("every payment references an existing invoice", () => {
    const seed = buildSeedDataset();
    const invoiceIds = new Set(seed.invoices.map((i) => i.id));
    for (const payment of seed.payments) {
      expect(invoiceIds.has(payment.invoiceId)).toBe(true);
    }
  });

  it("every invoice references an existing customer", () => {
    const seed = buildSeedDataset();
    const customerIds = new Set(seed.customers.map((c) => c.id));
    for (const invoice of seed.invoices) {
      expect(customerIds.has(invoice.customerId)).toBe(true);
    }
  });

  it("no payment is dated after settings.asOfDate", () => {
    const seed = buildSeedDataset();
    for (const payment of seed.payments) {
      expect(payment.date <= seed.settings.asOfDate).toBe(true);
    }
  });

  it("all invoice, payment and expense amounts are integers", () => {
    const seed = buildSeedDataset();
    for (const record of [...seed.invoices, ...seed.payments, ...seed.expenses]) {
      expect(Number.isInteger(record.amount)).toBe(true);
    }
  });

  it("any record with isDemoData defined has isDemoData === true", () => {
    const seed = buildSeedDataset();
    for (const record of [...seed.customers, ...seed.payments, ...seed.expenses]) {
      if (record.isDemoData !== undefined) {
        expect(record.isDemoData).toBe(true);
      }
    }
  });

  it("every paid invoice has payments summing to its amount", () => {
    const seed = buildSeedDataset();
    for (const invoice of seed.invoices.filter((i) => i.status === "paid")) {
      const paid = seed.payments
        .filter((p) => p.invoiceId === invoice.id)
        .reduce((sum, p) => sum + p.amount, 0);
      expect(paid).toBe(invoice.amount);
    }
  });
});
