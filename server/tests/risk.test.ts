import { describe, it, expect } from "vitest";
import type { Dataset, ForecastDay, ForecastResult, RiskFinding } from "../../shared/types.js";
import { buildSeedDataset } from "../src/data/seed.js";
import { forecastCashFlow } from "../src/core/forecast.js";
import { detectRisks } from "../src/core/risk.js";

const SEVERITIES = ["low", "medium", "high", "critical"];

describe("detectRisks on the seed dataset", () => {
  it("returns a cash-shortage finding with critical severity", () => {
    const seed = buildSeedDataset();
    const findings = detectRisks(seed, forecastCashFlow(seed));
    const shortage = findings.find((f) => f.id === "cash-shortage");
    expect(shortage).toBeDefined();
    expect(shortage?.severity).toBe("critical");
  });

  it("gives every finding a non-empty title, explanation and recommendedAction, a valid severity, and object metrics", () => {
    const seed = buildSeedDataset();
    const findings = detectRisks(seed, forecastCashFlow(seed));
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(finding.recommendedAction.length).toBeGreaterThan(0);
      expect(SEVERITIES).toContain(finding.severity);
      expect(typeof finding.metrics).toBe("object");
      expect(finding.metrics).not.toBeNull();
    }
  });

  it("includes a customer-concentration finding on the seed", () => {
    const seed = buildSeedDataset();
    const findings = detectRisks(seed, forecastCashFlow(seed));
    expect(findings.some((f: RiskFinding) => f.id === "customer-concentration")).toBe(true);
  });

  it("returns deep-equal arrays for two calls with the same input", () => {
    const seed = buildSeedDataset();
    const first = detectRisks(seed, forecastCashFlow(seed));
    const second = detectRisks(seed, forecastCashFlow(seed));
    expect(second).toEqual(first);
  });

  it("raises neither cash-shortage nor customer-concentration for a dataset with ₹10,00,000 opening balance and no invoices or expenses", () => {
    const seed = buildSeedDataset();
    const rich: Dataset = {
      ...seed,
      settings: { ...seed.settings, openingBalance: 100_000_000 },
      invoices: [],
      payments: [],
      expenses: [],
    };
    const findings = detectRisks(rich, forecastCashFlow(rich));
    expect(findings.some((f) => f.id === "cash-shortage")).toBe(false);
    expect(findings.some((f) => f.id === "customer-concentration")).toBe(false);
  });
});

/* ---------- short-runway (days-to-buffer-breach) ---------- */

const ASOF = "2025-05-31";

function dateAfterAsOf(offset: number): string {
  // offset 1 = 2025-06-01
  return new Date(Date.UTC(2025, 4, 31 + offset)).toISOString().slice(0, 10);
}

function makeForecast(balances: number[], safetyBuffer: number, shortageDate: string | null = null): ForecastResult {
  const days: ForecastDay[] = balances.map((balance, i) => ({
    date: dateAfterAsOf(i + 1),
    incoming: 0,
    outgoing: 0,
    balance,
  }));
  const minimumBalance = Math.min(...balances);
  const minIndex = balances.indexOf(minimumBalance);
  return {
    asOfDate: ASOF,
    horizonDays: balances.length,
    openingBalance: 6_000_000,
    safetyBuffer,
    days,
    minimumBalance,
    minimumBalanceDate: days[minIndex].date,
    shortageDate,
    shortageAmount: shortageDate === null ? 0 : -minimumBalance,
    cashRunwayDays: shortageDate === null ? balances.length : balances.findIndex((b) => b < 0) + 1,
    riskLevel: "low",
    bufferStatus: "above_buffer",
    assumptions: [],
    warnings: [],
  };
}

function baseDataset(): Dataset {
  const seed = buildSeedDataset();
  return {
    ...seed,
    settings: { ...seed.settings, asOfDate: ASOF, openingBalance: 6_000_000, safetyBuffer: 5_000_000 },
    invoices: [],
    payments: [],
    expenses: [],
  };
}

function shortRunway(findings: RiskFinding[]): RiskFinding | undefined {
  return findings.find((f) => f.id === "short-runway");
}

describe("short-runway rule", () => {
  it("raises short-runway when the balance first breaches the buffer on day 10 without going negative (regression)", () => {
    const balances = [
      ...Array<number>(9).fill(6_000_000),
      ...Array<number>(21).fill(4_000_000),
    ];
    const forecast = makeForecast(balances, 5_000_000);
    const finding = shortRunway(detectRisks(baseDataset(), forecast));
    expect(finding).toBeDefined();
    expect(finding?.metrics.runwayDays).toBe(10);
    expect(finding?.metrics.bufferBreachDate).toBe(dateAfterAsOf(10));
    expect(finding?.title).toContain("10 day(s)");
    expect(finding?.title).toContain(dateAfterAsOf(10));
  });

  it("does not raise short-runway when the balance stays above the buffer for all days", () => {
    const forecast = makeForecast(Array<number>(30).fill(6_000_000), 5_000_000);
    expect(shortRunway(detectRisks(baseDataset(), forecast))).toBeUndefined();
  });

  it("does not raise short-runway when a shortage is present", () => {
    const balances = [
      ...Array<number>(4).fill(6_000_000),
      -1_000_000,
      ...Array<number>(25).fill(-1_000_000),
    ];
    const forecast = makeForecast(balances, 5_000_000, dateAfterAsOf(5));
    const findings = detectRisks(baseDataset(), forecast);
    expect(findings.some((f) => f.id === "cash-shortage")).toBe(true);
    expect(shortRunway(findings)).toBeUndefined();
  });

  it("does not raise short-runway when the first below-buffer day is day 20", () => {
    const balances = [
      ...Array<number>(19).fill(6_000_000),
      ...Array<number>(11).fill(4_000_000),
    ];
    const forecast = makeForecast(balances, 5_000_000);
    expect(shortRunway(detectRisks(baseDataset(), forecast))).toBeUndefined();
  });

  it("gives severity high when the buffer breach is on day 5", () => {
    const balances = [
      ...Array<number>(4).fill(6_000_000),
      ...Array<number>(26).fill(4_000_000),
    ];
    const forecast = makeForecast(balances, 5_000_000);
    const finding = shortRunway(detectRisks(baseDataset(), forecast));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
    expect(finding?.metrics.runwayDays).toBe(5);
  });
});

