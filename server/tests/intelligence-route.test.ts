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

beforeEach(async () => {
  dataFile = path.join(os.tmpdir(), `intelligence-test-${randomUUID()}.json`);
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

const ALLOWED_CLASSIFICATIONS = ["reliable", "occasionally_late", "consistently_late", "insufficient_data"];

describe("GET /api/intelligence/customers", () => {
  it("returns one row per seeded customer with allowed classifications and integer scores", async () => {
    const seed = buildSeedDataset();
    const res = await call("GET", "/api/intelligence/customers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(seed.customers.length);
    for (const row of res.body as Array<{ classification: string; reliabilityScore: number | null }>) {
      expect(ALLOWED_CLASSIFICATIONS).toContain(row.classification);
      if (row.reliabilityScore !== null) {
        expect(Number.isInteger(row.reliabilityScore)).toBe(true);
      }
    }
  });

  it("GET /customers/:id returns the Sharma Textiles row", async () => {
    const sharma = buildSeedDataset().customers.find((c) => c.name === "Sharma Textiles");
    expect(sharma).toBeDefined();
    const res = await call("GET", `/api/intelligence/customers/${sharma!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(sharma!.id);
  });

  it("GET /customers/:id returns 404 for an unknown id", async () => {
    const res = await call("GET", "/api/intelligence/customers/cust-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Customer not found");
  });

  it("recording a 1-paise payment on an open invoice lowers that customer's outstanding by exactly 1", async () => {
    const sharmaId = "cust-sharma";
    const openInvoiceId = "inv-1049"; // status "sent" in the seed, customer cust-sharma

    const before = await call("GET", `/api/intelligence/customers/${sharmaId}`);
    expect(before.status).toBe(200);
    const outstandingBefore = before.body.outstanding as number;

    const paid = await call("POST", `/api/invoices/${openInvoiceId}/payments`, {
      date: "2025-06-15",
      amount: 1,
    });
    expect(paid.status).toBe(201);

    const after = await call("GET", `/api/intelligence/customers/${sharmaId}`);
    expect(after.status).toBe(200);
    expect(after.body.outstanding).toBe(outstandingBefore - 1);
  });
});
