import { describe, it, expect } from "vitest";
import { buildSeedDataset } from "../src/data/seed.js";
import { answerChat, answerDeterministically, classifyIntent, type ChatIntent } from "../src/ai/chat.js";
import { formatRupees } from "../src/ai/facts.js";
import type { LlmProvider } from "../src/ai/llm.js";
import { forecastCashFlow } from "../src/core/forecast.js";
import { buildDeterministicBriefing } from "../src/ai/deterministic.js";

const seed = buildSeedDataset();
const forecast = forecastCashFlow(seed);
const SHARMA_QUESTION = "What happens if Sharma Textiles pays 15 days late?";
const SHORTAGE_QUESTION = "Why will I run out of money?";
const TODAY_QUESTION = "How can I improve my cash position?";

const CANONICAL: Array<[string, ChatIntent]> = [
  [SHORTAGE_QUESTION, "shortage"],
  ["What does my next month look like?", "forecast"],
  [TODAY_QUESTION, "today_actions"],
  ["Who should I collect from first?", "collection_priority"],
  ["Which customers are risky?", "customer_risk"],
  [SHARMA_QUESTION, "scenario"],
  ["Can I afford this expense?", "expense_affordability"],
  ["How much money are customers yet to pay?", "receivables"],
  ["How much cash do I currently have?", "cash_position"],
  ["Tell me something", "general"],
];

/** Every figure in a deterministic answer, ignoring list numerals and digit grouping commas. */
function figuresIn(text: string): string[] {
  return text.replace(/^\s*\d+\.\s/gm, "").replace(/,/g, "").match(/\d+/g) ?? [];
}

function fakeProvider(complete: LlmProvider["complete"]): LlmProvider {
  return { name: "fake", complete };
}

describe("canonical intents", () => {
  it.each(CANONICAL)("%s -> %s", (question, intent) => {
    expect(classifyIntent(question)).toBe(intent);
    expect(answerDeterministically(question, seed).intent).toBe(intent);
  });
});

describe("fix questions", () => {
  it("'How do I fix this?' returns numbered briefing actions as today_actions with tagged facts", () => {
    const res = answerDeterministically("How do I fix this?", seed);
    expect(res.intent).toBe("today_actions");
    expect(res.answer).toContain("1.");
    const titles = buildDeterministicBriefing(seed).actions.map((a) => a.title);
    expect(titles.some((t) => res.answer.includes(t))).toBe(true);
    for (const fact of res.facts) {
      expect(fact).toMatch(/^\[(actual|forecast|scenario)\] /);
    }
  });
});

describe("word boundaries", () => {
  it("'plate' does not trigger scenario", () => {
    expect(classifyIntent("I want to plate a new order")).not.toBe("scenario");
  });

  it("'brisk' does not trigger shortage", () => {
    expect(classifyIntent("What is my brisk outlook?")).not.toBe("shortage");
  });
});

describe("variation and regression", () => {
  it("'Which customers should I worry about?' routes to a customer intent with its own answer", () => {
    const worry = answerDeterministically("Which customers should I worry about?", seed);
    expect(["customer_risk", "collection_priority"]).toContain(worry.intent);
    expect(worry.answer).not.toBe(answerDeterministically(SHORTAGE_QUESTION, seed).answer);
  });

  it("answers to three distinct questions are pairwise different", () => {
    const answers = [SHORTAGE_QUESTION, "How much cash do I currently have?", "Who should I collect from first?"].map(
      (q) => answerDeterministically(q, seed).answer,
    );
    expect(new Set(answers).size).toBe(3);
  });
});

describe("facts", () => {
  it.each(CANONICAL)("every fact is tagged, clean and free of bare 5+ digit runs for %s", (question) => {
    for (const fact of answerDeterministically(question, seed).facts) {
      expect(fact).toMatch(/^\[(actual|forecast|scenario)\] \S/);
      expect(fact).not.toMatch(/undefined|NaN/);
      expect(fact).not.toMatch(/\d{5,}/);
    }
  });

  it("a known customer's scenario carries at least one [scenario] fact", () => {
    const res = answerDeterministically(SHARMA_QUESTION, seed);
    expect(res.facts.some((f) => f.startsWith("[scenario]"))).toBe(true);
  });

  it("an unknown customer gives no rupee sign and no [scenario] fact", () => {
    const res = answerDeterministically("What happens if Nonexistent Ltd pays 15 days late?", seed);
    expect(res.answer).not.toContain("₹");
    expect(res.facts.some((f) => f.includes("[scenario]"))).toBe(false);
  });

  it("the shortage answer states the forecast minimum balance", () => {
    expect(answerDeterministically(SHORTAGE_QUESTION, seed).answer).toContain(formatRupees(forecast.minimumBalance));
  });

  it.each(CANONICAL)("every figure in the answer appears in the facts for %s", (question) => {
    const res = answerDeterministically(question, seed);
    const factFigures = new Set(figuresIn(res.facts.join(" ")));
    for (const figure of figuresIn(res.answer)) {
      expect(factFigures.has(figure)).toBe(true);
    }
  });
});

describe("provider output and fallback", () => {
  it("an answer repeating the deterministic text is accepted as ai/ok", async () => {
    const base = answerDeterministically(SHORTAGE_QUESTION, seed);
    const provider = fakeProvider(async () => JSON.stringify({ answer: base.answer }));
    const res = await answerChat(seed, { message: SHORTAGE_QUESTION }, { provider });
    expect(res.source).toBe("ai");
    expect(res.providerStatus).toBe("ok");
    expect(res.answer).toBe(base.answer);
  });

  it("an answer with an unseen figure is invalid_output and the deterministic answer is kept", async () => {
    const base = answerDeterministically(SHORTAGE_QUESTION, seed);
    const provider = fakeProvider(async () => JSON.stringify({ answer: "The gap is 99,999,999 rupees." }));
    const res = await answerChat(seed, { message: SHORTAGE_QUESTION }, { provider });
    expect(res.providerStatus).toBe("invalid_output");
    expect(res.answer).toBe(base.answer);
  });

  it("an answer keeping a numbered line from the deterministic answer is accepted as ok", async () => {
    const base = answerDeterministically(TODAY_QUESTION, seed);
    expect(base.answer).toMatch(/^1\. /m);
    const provider = fakeProvider(async () => JSON.stringify({ answer: base.answer }));
    const res = await answerChat(seed, { message: TODAY_QUESTION }, { provider });
    expect(res.source).toBe("ai");
    expect(res.providerStatus).toBe("ok");
  });

  it("a throwing provider is unavailable", async () => {
    const provider = fakeProvider(() => Promise.reject(new Error("network down")));
    const res = await answerChat(seed, { message: SHORTAGE_QUESTION }, { provider });
    expect(res.providerStatus).toBe("unavailable");
    expect(res.source).toBe("deterministic");
  });

  it("a provider that never resolves times out as unavailable", async () => {
    const provider = fakeProvider(() => new Promise<string>(() => {}));
    const res = await answerChat(seed, { message: SHORTAGE_QUESTION }, { provider, timeoutMs: 50 });
    expect(res.providerStatus).toBe("unavailable");
  });

  it("a non-JSON reply is invalid_output", async () => {
    const res = await answerChat(seed, { message: SHORTAGE_QUESTION }, { provider: fakeProvider(async () => "not json") });
    expect(res.providerStatus).toBe("invalid_output");
  });

  it("with no provider the status is not_configured", async () => {
    const res = await answerChat(seed, { message: SHORTAGE_QUESTION });
    expect(res.providerStatus).toBe("not_configured");
    expect(res.source).toBe("deterministic");
  });
});
