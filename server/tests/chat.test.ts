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
import { answerChat, answerDeterministically, buildChatContext, classifyIntent } from "../src/ai/chat.js";
import { buildDeterministicBriefing } from "../src/ai/deterministic.js";
import { formatRupees } from "../src/ai/facts.js";
import type { LlmProvider } from "../src/ai/llm.js";
import { forecastCashFlow } from "../src/core/forecast.js";
import { compareScenario } from "../src/core/scenario.js";

const seed = buildSeedDataset();
const forecast = forecastCashFlow(seed);
const SHARMA_ID = "cust-sharma";
const SECRET = "test-secret";

const savedKey = process.env.CFO_AI_API_KEY;
beforeEach(() => {
  delete process.env.CFO_AI_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.CFO_AI_API_KEY;
  else process.env.CFO_AI_API_KEY = savedKey;
});

function fakeProvider(complete: LlmProvider["complete"]): LlmProvider {
  return { name: "fake", complete };
}

describe("chat context", () => {
  it("contains the formatted projected minimum and the minimum date, and every fact is basis-tagged", () => {
    const ctx = buildChatContext(seed);
    expect(ctx.facts.some((f) => f.includes(formatRupees(forecast.minimumBalance)))).toBe(true);
    expect(ctx.facts.some((f) => f.includes("9 Jul 2025"))).toBe(true);
    for (const fact of ctx.facts) {
      expect(fact).toMatch(/^\[(actual|forecast|scenario)\] /);
    }
  });
});

describe("deterministic answers", () => {
  const examples: Array<[string, string]> = [
    ["Why will I run out of money?", "shortage"],
    ["What should I do today?", "today_actions"],
    ["Which customer should I contact first?", "collection_priority"],
    ["Can I afford my upcoming expenses?", "expense_affordability"],
    ["How can I prevent the projected shortage?", "prevention"],
  ];

  it.each(examples)("%s -> %s, not_configured, non-empty", (question, intent) => {
    const res = answerDeterministically(question, seed);
    expect(res.intent).toBe(intent);
    expect(classifyIntent(question)).toBe(intent);
    expect(res.providerStatus).toBe("not_configured");
    expect(res.source).toBe("deterministic");
    expect(res.answer.length).toBeGreaterThan(0);
  });

  it("scenario question uses the scenario minimum from compareScenario", () => {
    const res = answerDeterministically("What happens if Sharma Textiles pays 15 days late?", seed);
    const expected = compareScenario(seed, [{ type: "customer_delay", customerId: SHARMA_ID, days: 15 }]);
    expect(res.intent).toBe("scenario");
    expect(res.basis).toBe("scenario");
    expect(res.answer).toContain(formatRupees(expected.scenario.minimumBalance));
  });

  it("unknown customer gives no rupee figure and points to the missing information or the simulator", () => {
    const res = answerDeterministically("What happens if Nonexistent Ltd pays 15 days late?", seed);
    expect(res.intent).toBe("scenario");
    expect(res.answer).not.toContain("₹");
    expect(res.answer).toMatch(/could not find|Scenario Simulator/);
  });
});

describe("provider wording and validation", () => {
  const question = "Why will I run out of money?";

  it("a provider answer that repeats the deterministic text is accepted", async () => {
    const base = answerDeterministically(question, seed);
    const provider = fakeProvider(async () => JSON.stringify({ answer: base.answer }));
    const res = await answerChat(seed, { message: question }, { provider });
    expect(res.source).toBe("ai");
    expect(res.providerStatus).toBe("ok");
    expect(res.answer).toBe(base.answer);
  });

  it("an invented figure is rejected and the deterministic answer is kept", async () => {
    const base = answerDeterministically(question, seed);
    const provider = fakeProvider(async () => JSON.stringify({ answer: "You will run out on 3 Mar 2030." }));
    const res = await answerChat(seed, { message: question }, { provider });
    expect(res.providerStatus).toBe("invalid_output");
    expect(res.answer).toBe(base.answer);
  });

  it("a throwing provider is unavailable", async () => {
    const provider = fakeProvider(() => Promise.reject(new Error("network down")));
    const res = await answerChat(seed, { message: question }, { provider });
    expect(res.providerStatus).toBe("unavailable");
    expect(res.source).toBe("deterministic");
  });

  it("a provider that never resolves times out as unavailable", async () => {
    const provider = fakeProvider(() => new Promise<string>(() => {}));
    const started = Date.now();
    const res = await answerChat(seed, { message: question }, { provider, timeoutMs: 50 });
    expect(res.providerStatus).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("non-JSON output is invalid_output", async () => {
    const res = await answerChat(seed, { message: question }, { provider: fakeProvider(async () => "not json") });
    expect(res.providerStatus).toBe("invalid_output");
  });
});

describe("risk consequence regression", () => {
  it("severely-overdue consequence is readable: no raw labels, no unformatted paise, no bare 5+ digit runs", () => {
    const briefing = buildDeterministicBriefing(seed);
    const risk = briefing.risks.find((r) => r.riskId === "severely-overdue");
    expect(risk).toBeDefined();
    const text = risk!.consequence;
    expect(text).not.toContain("remaining ");
    expect(text).not.toContain("days overdue ₹");
    expect(text).not.toMatch(/\d{5,}/);
  });
});

describe("HTTP chat route", () => {
  let server: Server;
  let baseUrl: string;
  let dataFile: string;

  async function post(body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}/api/cfo/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
  }

  beforeEach(async () => {
    dataFile = path.join(os.tmpdir(), `chat-test-${randomUUID()}.json`);
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

  it("rejects an empty message with 400", async () => {
    expect((await post({ message: "" })).status).toBe(400);
  });

  it("rejects a 501-character message with 400", async () => {
    expect((await post({ message: "a".repeat(501) })).status).toBe(400);
  });

  it("answers a valid message without a key with not_configured", async () => {
    const res = await post({ message: "What should I do today?" });
    expect(res.status).toBe(200);
    expect(res.body.providerStatus).toBe("not_configured");
    expect(res.body.source).toBe("deterministic");
  });

  it("returns 422 for an unknown adjustment invoiceId", async () => {
    const res = await post({
      message: "What happens if I delay an invoice?",
      adjustments: [{ type: "invoice_delay", invoiceId: "inv-does-not-exist", days: 15 }],
    });
    expect(res.status).toBe(422);
  });
});

describe("no key leak", () => {
  it("the chat response never contains the API key value", async () => {
    process.env.CFO_AI_API_KEY = SECRET;
    const provider = fakeProvider(() => Promise.reject(new Error("provider failed")));
    const res = await answerChat(seed, { message: "What should I do today?" }, { provider });
    expect(JSON.stringify(res)).not.toContain(SECRET);
    expect(JSON.stringify(buildChatContext(seed).facts)).not.toContain(SECRET);
  });
});
