import { describe, it, expect } from "vitest";
import { buildSeedDataset } from "../src/data/seed.js";
import { forecastCashFlow } from "../src/core/forecast.js";
import { compareScenario } from "../src/core/scenario.js";

describe("compareScenario", () => {
  it("reports no differences when given no adjustments", () => {
    const seed = buildSeedDataset();
    const result = compareScenario(seed, []);
    expect(result.balanceDifference).toBe(0);
    expect(result.minimumBalanceDifference).toBe(0);
    expect(result.shortageDateAfter).toBe(result.shortageDateBefore);
    expect(result.shortageAmountAfter).toBe(result.shortageAmountBefore);
    expect(result.riskLevelAfter).toBe(result.riskLevelBefore);
    expect(result.runwayDaysAfter).toBe(result.runwayDaysBefore);
  });

  it("returns a baseline that deep-equals forecastCashFlow on the same dataset", () => {
    const seed = buildSeedDataset();
    const result = compareScenario(seed, []);
    expect(result.baseline).toEqual(forecastCashFlow(seed));
  });

  it("does not raise the minimum balance when Sharma Textiles pays 15 days later", () => {
    const seed = buildSeedDataset();
    const sharma = seed.customers.find((c) => c.name === "Sharma Textiles");
    if (!sharma) throw new Error("Seed is missing Sharma Textiles");
    const result = compareScenario(seed, [{ type: "customer_delay", customerId: sharma.id, days: 15 }]);
    expect(result.scenario.minimumBalance).toBeLessThanOrEqual(result.baseline.minimumBalance);
  });

  it("does not bring the shortage date earlier when the rent expense is postponed", () => {
    const seed = buildSeedDataset();
    const rent = seed.expenses.find((e) => e.name.toLowerCase().includes("rent"));
    if (!rent) throw new Error("Seed is missing a rent expense");
    const result = compareScenario(seed, [{ type: "expense_postponement", expenseId: rent.id, days: 10 }]);
    const baselineShortage = result.baseline.shortageDate;
    const scenarioShortage = result.scenario.shortageDate;
    if (baselineShortage !== null) {
      expect(scenarioShortage === null || scenarioShortage >= baselineShortage).toBe(true);
    }
  });
});
