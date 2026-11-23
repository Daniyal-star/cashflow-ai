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
import { buildDeterministicBriefing } from "../src/ai/deterministic.js";
import { generateCfoBriefing } from "../src/ai/cfoAdvisor.js";
import { createProviderFromEnv, type LlmProvider } from "../src/ai/llm.js";
import { forecastCashFlow } from "../src/core/forecast.js";
import { openReceivables } from "../src/core/receivables.js";
import { detectRisks } from "../src/core/risk.js";
import { compareScenario } from "../src/core/scenario.js";

const seed = buildSeedDataset();
const asOf = seed.settings.asOfDate;
const forecast = forecastCashFlow(seed);
const openInvoiceId = openReceivables(seed, asOf)[0]!.invoiceId;
const SECRET = "sk-test-secret-key-123";

const savedKey = process.env.CFO_AI_API_KEY;
beforeEach(() => {
  delete process.env.CFO_AI_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.CFO_AI_API_KEY;
  else process.env.CFO_AI_API_KEY = savedKey;
});

/** Numeric values in a string, with commas removed (same rule as the validator's number guard). */
function numbersIn(text: string): number[] {
  return Array.from(text.replace(/,/g, "").matchAll(/\d+/g), (m) => Number(m[0]));
}

function fakeProvider(complete: LlmProvider["complete"]): LlmProvider {
  return { name: "fake", complete };
}

describe("deterministic facts", () => {
  it("metrics match the forecast minimum balance, shortage date and outstanding receivables", () => {
    const briefing = buildDeterministicBriefing(seed);
    const outstanding = openReceivables(seed, asOf).reduce((sum, r) => sum + r.remaining, 0);
    expect(briefing.metrics.projectedMinimumBalance).toBe(forecast.minimumBalance);
    expect(briefing.metrics.shortageDate).toBe(forecast.shortageDate);
    expect(briefing.metrics.outstandingReceivables).toBe(outstanding);
  });

  it("every number in the summary appears in the JSON-derived facts", () => {
    const briefing = buildDeterministicBriefing(seed);
    const facts = new Set(numbersIn(JSON.stringify(briefing)));
    for (const token of numbersIn(briefing.summary)) {
      expect(facts.has(token)).toBe(true);
    }
  });

  it("is deterministic: two calls are deep-equal", () => {
    expect(buildDeterministicBriefing(seed)).toEqual(buildDeterministicBriefing(seed));
  });

  it("produces one risk item per detected finding, in the same order, with explanations", () => {
    const findings = detectRisks(seed, forecast);
    const briefing = buildDeterministicBriefing(seed);
    expect(briefing.risks.length).toBe(findings.length);
    expect(briefing.risks.map((r) => r.riskId)).toEqual(findings.map((f) => f.id));
    for (const risk of briefing.risks) {
      expect(risk.explanation.length).toBeGreaterThan(0);
      expect(risk.consequence.length).toBeGreaterThan(0);
      expect(["now", "this_week", "this_month"]).toContain(risk.urgency);
    }
  });

  it("includes protect-shortage, ranks actions 1..n, and never places this_week before now", () => {
    const { actions } = buildDeterministicBriefing(seed);
    expect(actions.some((a) => a.id.startsWith("protect-shortage"))).toBe(true);
    expect(actions.map((a) => a.rank)).toEqual(actions.map((_, i) => i + 1));
    const rank: Record<string, number> = { now: 0, this_week: 1, this_month: 2 };
    for (let i = 1; i < actions.length; i++) {
      expect(rank[actions[i - 1]!.urgency]!).toBeLessThanOrEqual(rank[actions[i]!.urgency]!);
    }
  });

  it("scenario advice is built from baseline and scenario minimum balances", () => {
    const adjustments = [{ type: "invoice_delay" as const, invoiceId: openInvoiceId, days: 15 }];
    const briefing = buildDeterministicBriefing(seed, adjustments);
    const comparison = compareScenario(seed, adjustments);
    expect(briefing.scenario).not.toBeNull();
    expect(briefing.scenario!.minimumBalanceBefore).toBe(forecast.minimumBalance);
    expect(briefing.scenario!.minimumBalanceAfter).toBe(comparison.scenario.minimumBalance);
  });

  it("scenario is null when there are no adjustments", () => {
    expect(buildDeterministicBriefing(seed).scenario).toBeNull();
    expect(buildDeterministicBriefing(seed, []).scenario).toBeNull();
  });
});

describe("provider fallback and validation", () => {
  it("no provider returns the deterministic briefing with not_configured", async () => {
    const briefing = await generateCfoBriefing(seed);
    expect(briefing.providerStatus).toBe("not_configured");
    expect(briefing.source).toBe("deterministic");
  });

  it("a rejecting provider returns unavailable with the deterministic result", async () => {
    const provider = fakeProvider(() => Promise.reject(new Error("network down")));
    const briefing = await generateCfoBriefing(seed, { provider });
    expect(briefing.providerStatus).toBe("unavailable");
    expect(briefing.source).toBe("deterministic");
    expect(briefing).toEqual({ ...buildDeterministicBriefing(seed), providerStatus: "unavailable" });
  });

  it("non-JSON output returns invalid_output with deterministic source", async () => {
    const briefing = await generateCfoBriefing(seed, { provider: fakeProvider(async () => "not json") });
    expect(briefing.providerStatus).toBe("invalid_output");
    expect(briefing.source).toBe("deterministic");
  });

  it("an invented figure is rejected and the deterministic summary is kept", async () => {
    const raw = JSON.stringify({ summary: "Balance is 123456789 paise.", risks: [], actions: [] });
    const briefing = await generateCfoBriefing(seed, { provider: fakeProvider(async () => raw) });
    expect(briefing.providerStatus).toBe("invalid_output");
    expect(briefing.summary).toBe(buildDeterministicBriefing(seed).summary);
  });

  it("valid reworded output is accepted, keeping metrics and ordering", async () => {
    const base = buildDeterministicBriefing(seed);
    const raw = JSON.stringify({ summary: base.summary.replace(/^Available/, "Current"), risks: [], actions: [] });
    const briefing = await generateCfoBriefing(seed, { provider: fakeProvider(async () => raw) });
    expect(briefing.providerStatus).toBe("ok");
    expect(briefing.source).toBe("ai");
    expect(briefing.summary).toBe(base.summary.replace(/^Available/, "Current"));
    expect(briefing.metrics).toEqual(base.metrics);
    expect(briefing.risks.map((r) => r.riskId)).toEqual(base.risks.map((r) => r.riskId));
    expect(briefing.actions.map((a) => [a.id, a.rank, a.urgency])).toEqual(
      base.actions.map((a) => [a.id, a.rank, a.urgency]),
    );
  });

  it("an unknown riskId is rejected", async () => {
    const raw = JSON.stringify({ summary: "Summary.", risks: [{ riskId: "no-such-risk", explanation: "x" }], actions: [] });
    const briefing = await generateCfoBriefing(seed, { provider: fakeProvider(async () => raw) });
    expect(briefing.providerStatus).toBe("invalid_output");
  });

  it("a provider that never resolves times out as unavailable", async () => {
    const provider = fakeProvider(() => new Promise<string>(() => {}));
    const started = Date.now();
    const briefing = await generateCfoBriefing(seed, { provider, timeoutMs: 50 });
    expect(briefing.providerStatus).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("environment configuration", () => {
  it("no key gives no provider; a key gives a named provider that never leaks into briefings", async () => {
    expect(createProviderFromEnv({})).toBeNull();
    const provider = createProviderFromEnv({ CFO_AI_API_KEY: SECRET });
    expect(provider).not.toBeNull();
    expect(typeof provider!.name).toBe("string");

    const briefings = [
      buildDeterministicBriefing(seed),
      buildDeterministicBriefing(seed, [{ type: "invoice_delay", invoiceId: openInvoiceId, days: 15 }]),
      await generateCfoBriefing(seed),
      await generateCfoBriefing(seed, { provider: fakeProvider(async () => "not json") }),
    ];
    for (const briefing of briefings) {
      expect(JSON.stringify(briefing)).not.toContain(SECRET);
    }
  });
});

describe("HTTP routes", () => {
  let server: Server;
  let baseUrl: string;
  let dataFile: string;

  async function call(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
  }

  beforeEach(async () => {
    dataFile = path.join(os.tmpdir(), `cfo-test-${randomUUID()}.json`);
    createDataStore(dataFile).save(buildSeedDataset());
    server = createApp({ dataFile }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(dataFile, { force: true });
  });

  it("GET /api/cfo/briefing returns 200 with not_configured when no key is set", async () => {
    const res = await call("GET", "/api/cfo/briefing");
    expect(res.status).toBe(200);
    expect(res.body.providerStatus).toBe("not_configured");
  });

  it("POST /api/cfo/briefing/scenario returns 422 for an unknown invoiceId", async () => {
    const res = await call("POST", "/api/cfo/briefing/scenario", {
      adjustments: [{ type: "invoice_delay", invoiceId: "inv-does-not-exist", days: 15 }],
    });
    expect(res.status).toBe(422);
  });

  it("POST /api/cfo/briefing/scenario returns 400 for 11 adjustments", async () => {
    const adjustments = Array.from({ length: 11 }, () => ({ type: "invoice_delay", invoiceId: openInvoiceId, days: 1 }));
    const res = await call("POST", "/api/cfo/briefing/scenario", { adjustments });
    expect(res.status).toBe(400);
  });

  it("POST /api/cfo/briefing/scenario returns 200 with a scenario for a valid invoice_delay", async () => {
    const res = await call("POST", "/api/cfo/briefing/scenario", {
      adjustments: [{ type: "invoice_delay", invoiceId: openInvoiceId, days: 15 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.scenario).not.toBeNull();
  });
});
