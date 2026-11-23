/**
 * Scenario comparison for CASHFLOW AI.
 *
 * Uses the same forecast engine for baseline and scenario, so no separate arithmetic is done here.
 * No randomness, no Date.now(). All money is integer paise.
 */

import type { Dataset, ForecastResult, ScenarioAdjustment, ScenarioComparison } from "../../../shared/types.js";
import { forecastCashFlow } from "./forecast.js";

function endingBalance(forecast: ForecastResult): number {
  const lastDay = forecast.days[forecast.days.length - 1];
  return lastDay !== undefined ? lastDay.balance : forecast.openingBalance;
}

export function compareScenario(dataset: Dataset, adjustments: ScenarioAdjustment[]): ScenarioComparison {
  const baseline = forecastCashFlow(dataset);
  const scenario = forecastCashFlow(dataset, { adjustments });

  return {
    baseline,
    scenario,
    balanceDifference: endingBalance(scenario) - endingBalance(baseline),
    minimumBalanceDifference: scenario.minimumBalance - baseline.minimumBalance,
    shortageDateBefore: baseline.shortageDate,
    shortageDateAfter: scenario.shortageDate,
    shortageAmountBefore: baseline.shortageAmount,
    shortageAmountAfter: scenario.shortageAmount,
    riskLevelBefore: baseline.riskLevel,
    riskLevelAfter: scenario.riskLevel,
    runwayDaysBefore: baseline.cashRunwayDays,
    runwayDaysAfter: scenario.cashRunwayDays,
  };
}
