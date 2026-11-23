import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/index.js";
import { buildSeedDataset } from "../src/data/seed.js";
import { createDataStore } from "../src/data/store.js";

// Response bodies are loosely typed on purpose: each test asserts only the fields the rules name.
interface ApiResult {
  status: number;
  body: any;
}

let server: Server;
let baseUrl: string;
let dataFile: string;
let counter = 0;

async function call(method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

/** Create an unpaid invoice for cust-mehta with defaults that are not overdue. */
async function createInvoice(overrides: Record<string, unknown> = {}): Promise<ApiResult> {
  counter += 1;
  return call("POST", "/api/invoices", {
    invoiceNumber: `TEST-${counter}`,
    customerId: "cust-mehta",
    issueDate: "2025-06-01",
    dueDate: "2025-07-01",
    amount: 100000,
    ...overrides,
  });
}

async function pay(invoiceId: string, amount: number, date = "2025-06-10"): Promise<ApiResult> {
  return call("POST", `/api/invoices/${invoiceId}/payments`, { date, amount });
}

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `crm-test-${randomUUID()}.json`);
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

describe("customers CRUD", () => {
  it("POST creates a customer (201) and GET by id returns it", async () => {
    const created = await call("POST", "/api/customers", { name: "Test Co", email: "billing@testco.example" });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe("string");

    const fetched = await call("GET", `/api/customers/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe("Test Co");
  });

  it("PUT changes the customer name (200)", async () => {
    const created = await call("POST", "/api/customers", { name: "Old Name" });
    const updated = await call("PUT", `/api/customers/${created.body.id}`, { name: "New Name" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("New Name");
  });

  it("POST with an empty name returns 400 with an error string", async () => {
    const res = await call("POST", "/api/customers", { name: "" });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("POST with an invalid email returns 400", async () => {
    const res = await call("POST", "/api/customers", { name: "Test Co", email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("DELETE a customer with no invoices returns 204 and GET then returns 404", async () => {
    const created = await call("POST", "/api/customers", { name: "Lonely Co" });
    const deleted = await call("DELETE", `/api/customers/${created.body.id}`);
    expect(deleted.status).toBe(204);

    const fetched = await call("GET", `/api/customers/${created.body.id}`);
    expect(fetched.status).toBe(404);
  });

  it("DELETE a customer that has invoices returns 409", async () => {
    const res = await call("DELETE", "/api/customers/cust-sharma");
    expect(res.status).toBe(409);
  });
});

describe("invoices CRUD", () => {
  it("POST with a valid body returns 201, status sent, paidAmount 0 and balance equal to amount", async () => {
    const res = await call("POST", "/api/invoices", {
      invoiceNumber: "CRM-2001",
      customerId: "cust-mehta",
      issueDate: "2025-06-01",
      dueDate: "2025-07-01",
      amount: 250000,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("sent");
    expect(res.body.paidAmount).toBe(0);
    expect(res.body.balance).toBe(250000);
    expect(res.body.amount).toBe(250000);
  });

  it("POST with dueDate before issueDate returns 400", async () => {
    const res = await createInvoice({ issueDate: "2025-06-10", dueDate: "2025-06-01" });
    expect(res.status).toBe(400);
  });

  it("POST with an unknown customerId returns 422", async () => {
    const res = await createInvoice({ customerId: "cust-does-not-exist" });
    expect(res.status).toBe(422);
  });

  it("POST with a duplicate invoiceNumber returns 409", async () => {
    const res = await createInvoice({ invoiceNumber: "INV-1040" });
    expect(res.status).toBe(409);
  });

  it("PUT an amount below the already-paid total returns 422", async () => {
    const invoice = await createInvoice({ amount: 100000 });
    const paid = await pay(invoice.body.id, 40000);
    expect(paid.status).toBe(201);

    const res = await call("PUT", `/api/invoices/${invoice.body.id}`, { amount: 30000 });
    expect(res.status).toBe(422);
  });

  it("DELETE an invoice returns 204 and its payments are gone (payments GET returns 404)", async () => {
    const invoice = await createInvoice();
    await pay(invoice.body.id, 40000);
    const before = await call("GET", `/api/invoices/${invoice.body.id}/payments`);
    expect(before.status).toBe(200);
    expect(before.body).toHaveLength(1);

    const deleted = await call("DELETE", `/api/invoices/${invoice.body.id}`);
    expect(deleted.status).toBe(204);

    const after = await call("GET", `/api/invoices/${invoice.body.id}/payments`);
    expect(after.status).toBe(404);
  });
});

describe("payments and derived status", () => {
  it("a partial payment returns 201 with paidAmount 40000, balance 60000 and status partially_paid", async () => {
    const invoice = await createInvoice({ amount: 100000 });
    const res = await pay(invoice.body.id, 40000);
    expect(res.status).toBe(201);
    expect(res.body.paidAmount).toBe(40000);
    expect(res.body.balance).toBe(60000);
    expect(res.body.status).toBe("partially_paid");
  });

  it("paying the remaining balance makes the invoice paid; a further payment returns 422 already fully paid", async () => {
    const invoice = await createInvoice({ amount: 100000 });
    await pay(invoice.body.id, 40000);

    const full = await pay(invoice.body.id, 60000);
    expect(full.status).toBe(201);
    expect(full.body.status).toBe("paid");
    expect(full.body.balance).toBe(0);

    const extra = await pay(invoice.body.id, 1000);
    expect(extra.status).toBe(422);
    expect(extra.body.error).toContain("already fully paid");
  });

  it("an overpayment returns 422 and leaves the invoice and payment count unchanged", async () => {
    const invoice = await createInvoice({ amount: 100000 });
    await pay(invoice.body.id, 40000);

    const res = await pay(invoice.body.id, 60001);
    expect(res.status).toBe(422);

    const current = await call("GET", `/api/invoices/${invoice.body.id}`);
    expect(current.body.balance).toBe(60000);
    const payments = await call("GET", `/api/invoices/${invoice.body.id}/payments`);
    expect(payments.body).toHaveLength(1);
  });

  it("an unpaid invoice due 2025-06-01 is overdue with daysOverdue 14, and stays overdue after a partial payment", async () => {
    const invoice = await createInvoice({ issueDate: "2025-05-01", dueDate: "2025-06-01", amount: 100000 });
    expect(invoice.body.status).toBe("overdue");
    expect(invoice.body.daysOverdue).toBe(14);

    const paid = await pay(invoice.body.id, 30000);
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe("overdue");
    expect(paid.body.balance).toBeGreaterThan(0);
  });

  it("a payment dated after the as-of date 2025-06-15 returns 422", async () => {
    const invoice = await createInvoice({ amount: 100000 });
    const res = await pay(invoice.body.id, 1000, "2025-06-16");
    expect(res.status).toBe(422);
  });

  it("PUT cancelled true sets status cancelled, and a payment on it returns 422", async () => {
    const invoice = await createInvoice({ amount: 100000 });
    const updated = await call("PUT", `/api/invoices/${invoice.body.id}`, { cancelled: true });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("cancelled");

    const res = await pay(invoice.body.id, 1000);
    expect(res.status).toBe(422);
  });
});

describe("dashboard consistency", () => {
  it("outstandingReceivables rises by the new invoice amount and returns after a full payment", async () => {
    const before = await call("GET", "/api/dashboard");
    const outstandingBefore = before.body.kpis.outstandingReceivables as number;

    const invoice = await createInvoice({
      customerId: "cust-sharma",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      amount: 500000,
    });
    expect(invoice.status).toBe(201);

    const after = await call("GET", "/api/dashboard");
    expect(after.body.kpis.outstandingReceivables).toBe(outstandingBefore + 500000);

    const full = await pay(invoice.body.id, 500000, "2025-06-15");
    expect(full.status).toBe(201);

    const settled = await call("GET", "/api/dashboard");
    expect(settled.body.kpis.outstandingReceivables).toBe(outstandingBefore);
  });

  it("collectionPriorities includes cust-sharma exactly when its outstanding is above zero", async () => {
    const customer = await call("GET", "/api/customers/cust-sharma");
    const dashboard = await call("GET", "/api/dashboard");
    const ids = (dashboard.body.collectionPriorities as Array<{ customerId: string }>).map((row) => row.customerId);
    expect(ids.includes("cust-sharma")).toBe(customer.body.outstanding > 0);
  });

  it("overdueReceivables rises by the balance of a newly created overdue invoice", async () => {
    const before = await call("GET", "/api/dashboard");
    const overdueBefore = before.body.kpis.overdueReceivables as number;

    const invoice = await createInvoice({ issueDate: "2025-05-01", dueDate: "2025-06-01", amount: 80000 });
    expect(invoice.body.status).toBe("overdue");

    const after = await call("GET", "/api/dashboard");
    expect(after.body.kpis.overdueReceivables).toBe(overdueBefore + invoice.body.balance);
  });
});

describe("invoice status filter", () => {
  it("GET /api/invoices?status=overdue returns only overdue invoices, including the seeded INV-1047", async () => {
    await createInvoice({ issueDate: "2025-05-01", dueDate: "2025-06-01", amount: 80000 });

    const res = await call("GET", "/api/invoices?status=overdue");
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: string; status: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe("overdue");
    }
    expect(rows.map((row) => row.id)).toContain("inv-1047");
  });

  it("GET /api/invoices?status=bogus returns 400", async () => {
    const res = await call("GET", "/api/invoices?status=bogus");
    expect(res.status).toBe(400);
  });
});
