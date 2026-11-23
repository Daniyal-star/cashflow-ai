/**
 * Deterministic AI CFO briefing.
 *
 * Every financial number comes from forecastCashFlow, detectRisks, compareScenario or openReceivables.
 * No LLM is involved here; the AI layer may only reword the text this file produces.
 * All money is integer paise; all dates are "YYYY-MM-DD".
 */

import type {
  ActionUrgency,
  AiCfoAction,
  AiCfoBriefing,
  AiCfoRiskItem,
  AiCfoScenarioAdvice,
  Dataset,
  ForecastResult,
  RiskFinding,
  RiskSeverity,
  ScenarioAdjustment,
  ScenarioComparison,
} from "../../../shared/types.js";
import { isValidIsoDate, compareIso } from "../core/dates.js";
import { forecastCashFlow } from "../core/forecast.js";
import { openReceivables, type OpenReceivable } from "../core/receivables.js";
import { detectRisks } from "../core/risk.js";
import { compareScenario } from "../core/scenario.js";
import { formatDateLabel, formatRupees } from "./facts.js";

type ActionDraft = Omit<AiCfoAction, "rank">;

const URGENCY_RANK: Record<ActionUrgency, number> = { now: 0, this_week: 1, this_month: 2 };
const OVERDUE_NOW_DAYS = 30;

function urgencyForSeverity(severity: RiskSeverity): ActionUrgency {
  if (severity === "critical" || severity === "high") return "now";
  return severity === "medium" ? "this_week" : "this_month";
}

function dateOrNone(date: string | null): string {
  return date === null ? "none" : formatDateLabel(date);
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").toLowerCase();
}

/** Metric formatting for the generic fallback. Order matters: day counts are checked before money (e.g. "daysOverdue"). */
function formatMetric(key: string, value: number | string): string {
  if (typeof value === "string") return isValidIsoDate(value) ? formatDateLabel(value) : value;
  if (/share|ratio/i.test(key)) return `${(value * 100).toFixed(1)}%`;
  if (/days|runway/i.test(key)) return dayCount(value);
  if (/amount|balance|inflow|outflow|expense|receivable|overdue|outstanding|buffer|expected|impact|remaining|opening|ending|netOutflow|recurring/i.test(key)) {
    return formatRupees(value);
  }
  return String(value);
}

function dayCount(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

function metricNumber(finding: RiskFinding, key: string): number {
  const value = finding.metrics[key];
  return typeof value === "number" ? value : 0;
}

function metricText(finding: RiskFinding, key: string): string {
  const value = finding.metrics[key];
  return typeof value === "string" ? value : "";
}

/** Consequence sentence: what happens if the finding is not acted on. Does not restate the explanation. */
function consequenceFor(finding: RiskFinding, forecast: ForecastResult): string {
  switch (finding.id) {
    case "cash-shortage":
      return `Payments due from ${formatDateLabel(metricText(finding, "shortageDate"))} cannot be met from the balance unless the ${formatRupees(forecast.shortageAmount)} gap is funded or deferred first.`;
    case "below-safety-buffer":
      return `With little headroom, an unexpected payment before ${formatDateLabel(metricText(finding, "minimumBalanceDate"))} would push the balance below zero.`;
    case "short-runway":
      return `If nothing changes, the balance breaches the safety buffer within ${dayCount(metricNumber(finding, "runwayDays"))}, and any collection delay could turn that into a shortage.`;
    case "declining-liquidity":
      return "If outflows keep running ahead of receipts, the balance keeps falling after the forecast horizon ends.";
    case "severely-overdue":
      return `At ${dayCount(metricNumber(finding, "daysOverdue"))} past due, every further week lowers the chance of recovery. Until ${formatRupees(metricNumber(finding, "remaining"))} is collected it cannot fund upcoming payments.`;
    case "high-overdue-share":
      return "Cash tied up in past-due receivables cannot be relied on for upcoming payments, so any further slippage hits the forecast directly.";
    case "repeatedly-late-customer":
      return `Cash from ${metricText(finding, "customer")} should not be assumed to arrive on the due date; plan for a delay of several weeks.`;
    case "customer-concentration":
      return `A late payment from ${metricText(finding, "customer")} could widen a projected gap by up to ${formatRupees(metricNumber(finding, "expectedInflow"))}.`;
    case "large-upcoming-expense":
      return `If collections slip around ${formatDateLabel(metricText(finding, "dueDate"))}, ${metricText(finding, "expense")} must be paid from the buffer or it goes unpaid.`;
    case "recurring-commitments":
      return "Fixed recurring payments leave less room to absorb a slip in collections without missing a payment.";
    case "outflows-exceed-inflows":
      return `Unless receipts rise or payments move, the balance ends the horizon ${formatRupees(metricNumber(finding, "netOutflow"))} lower than the receipts cover.`;
    default: {
      const parts = Object.entries(finding.metrics)
        .filter((entry): entry is [string, number | string] => entry[1] !== null)
        .map(([key, value]) => `${humanize(key)} ${formatMetric(key, value)}`);
      return parts.length > 0 ? `Exposure: ${parts.join(", ")}.` : "The exposure is not quantified by the risk engine.";
    }
  }
}

function buildRiskItems(risks: RiskFinding[], forecast: ForecastResult): AiCfoRiskItem[] {
  return risks.map((finding) => ({
    riskId: finding.id,
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    consequence: consequenceFor(finding, forecast),
    urgency: urgencyForSeverity(finding.severity),
  }));
}

interface CustomerOverdue {
  customerId: string;
  name: string;
  overdue: number;
  maxDays: number;
  invoiceNumbers: string[];
}

function overdueByCustomer(dataset: Dataset, receivables: OpenReceivable[]): CustomerOverdue[] {
  const names = new Map((dataset.customers ?? []).map((customer) => [customer.id, customer.name]));
  const byCustomer = new Map<string, CustomerOverdue>();
  for (const receivable of receivables) {
    if (receivable.daysOverdue <= 0) continue;
    let entry = byCustomer.get(receivable.customerId);
    if (entry === undefined) {
      entry = {
        customerId: receivable.customerId,
        name: names.get(receivable.customerId) ?? receivable.customerId,
        overdue: 0,
        maxDays: 0,
        invoiceNumbers: [],
      };
      byCustomer.set(receivable.customerId, entry);
    }
    entry.overdue += receivable.remaining;
    entry.maxDays = Math.max(entry.maxDays, receivable.daysOverdue);
    entry.invoiceNumbers.push(receivable.invoiceNumber);
  }
  return [...byCustomer.values()];
}

function buildActions(
  dataset: Dataset,
  forecast: ForecastResult,
  risks: RiskFinding[],
  receivables: OpenReceivable[],
): AiCfoAction[] {
  const shortageDate = forecast.shortageDate;
  const shortageAmount = forecast.shortageAmount;
  const overdueTotal = receivables.reduce((sum, r) => sum + (r.daysOverdue > 0 ? r.remaining : 0), 0);
  const coverage = (amount: number): number | null =>
    shortageAmount > 0 ? Math.min(1, amount / shortageAmount) : null;
  const drafts: ActionDraft[] = [];

  for (const customer of overdueByCustomer(dataset, receivables)) {
    drafts.push({
      id: `collect-overdue-${customer.customerId}`,
      title: `Collect overdue balance from ${customer.name}`,
      detail: `${formatRupees(customer.overdue)} is overdue by up to ${customer.maxDays} days on ${customer.invoiceNumbers.join(", ")}. Contact them today.`,
      urgency: customer.maxDays >= OVERDUE_NOW_DAYS ? "now" : "this_week",
      expectedImpact: customer.overdue,
      coverageShare: coverage(customer.overdue),
    });
  }

  if (shortageDate !== null) {
    const shortageLabel = formatDateLabel(shortageDate);
    drafts.push({
      id: "protect-shortage",
      title: `Close the ${formatRupees(shortageAmount)} gap before ${shortageLabel}`,
      detail: `Projected balance is negative from ${shortageLabel}. Collect overdue receivables or defer an upcoming expense before that date.`,
      urgency: "now",
      expectedImpact: shortageAmount,
      coverageShare: coverage(overdueTotal),
    });

    // Largest single outgoing day on or before the shortage date; ties resolve to the earliest date.
    let largest: { date: string; amount: number } | null = null;
    for (const day of forecast.days) {
      if (compareIso(day.date, shortageDate) > 0) break;
      if (day.outgoing > 0 && (largest === null || day.outgoing > largest.amount)) {
        largest = { date: day.date, amount: day.outgoing };
      }
    }
    if (largest !== null) {
      drafts.push({
        id: "defer-largest-expense",
        title: `Ask to defer the largest payment due by ${shortageLabel}`,
        detail: `${formatRupees(largest.amount)} is due on ${formatDateLabel(largest.date)}. Postponing it is modelled in the Scenario Simulator.`,
        urgency: "this_week",
        expectedImpact: largest.amount,
        coverageShare: coverage(largest.amount),
      });
    }
  }

  const concentration = risks.find((risk) => risk.id === "customer-concentration");
  if (concentration !== undefined) {
    const customer = concentration.metrics.customer;
    drafts.push({
      id: "reduce-concentration",
      title: `Reduce dependence on ${typeof customer === "string" ? customer : "the largest customer"}`,
      detail: concentration.explanation,
      urgency: "this_month",
      expectedImpact: 0,
      coverageShare: null,
    });
  }

  drafts.sort(
    (a, b) =>
      URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
      b.expectedImpact - a.expectedImpact ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return drafts.map((draft, index) => ({ ...draft, rank: index + 1 }));
}

function buildScenarioAdvice(comparison: ScenarioComparison): AiCfoScenarioAdvice {
  const before = comparison.shortageDateBefore;
  const after = comparison.shortageDateAfter;
  const worse =
    comparison.shortageAmountAfter > comparison.shortageAmountBefore ||
    (after !== null && (before === null || compareIso(after, before) < 0));
  return {
    summary: `Minimum balance moves from ${formatRupees(comparison.baseline.minimumBalance)} to ${formatRupees(comparison.scenario.minimumBalance)}; shortage date from ${dateOrNone(before)} to ${dateOrNone(after)}; risk level from ${comparison.riskLevelBefore} to ${comparison.riskLevelAfter}.`,
    shortageDateBefore: before,
    shortageDateAfter: after,
    minimumBalanceBefore: comparison.baseline.minimumBalance,
    minimumBalanceAfter: comparison.scenario.minimumBalance,
    riskLevelBefore: comparison.riskLevelBefore,
    riskLevelAfter: comparison.riskLevelAfter,
    actionHint: worse
      ? "Consider collecting the affected invoice earlier or deferring an expense; test this in the Scenario Simulator."
      : "This scenario does not worsen the shortage.",
  };
}

export function buildDeterministicBriefing(dataset: Dataset, adjustments?: ScenarioAdjustment[]): AiCfoBriefing {
  const forecast = forecastCashFlow(dataset);
  const risks = detectRisks(dataset, forecast);
  const asOf = dataset.settings.asOfDate;
  const receivables = openReceivables(dataset, asOf);

  const outstandingReceivables = receivables.reduce((sum, r) => sum + r.remaining, 0);
  const overdueReceivables = receivables.reduce((sum, r) => sum + (r.daysOverdue > 0 ? r.remaining : 0), 0);
  const upcomingExpenses = forecast.days.reduce((sum, day) => sum + day.outgoing, 0);
  const expectedInflows = forecast.days.reduce((sum, day) => sum + day.incoming, 0);
  const availableCash = dataset.settings.openingBalance;

  const summaryParts = [
    `Available cash is ${formatRupees(availableCash)} against ${formatRupees(outstandingReceivables)} of receivables outstanding, of which ${formatRupees(overdueReceivables)} is overdue.`,
  ];
  if (forecast.shortageDate !== null) {
    summaryParts.push(
      `Projected cash falls below zero on ${formatDateLabel(forecast.shortageDate)}, a shortage of ${formatRupees(forecast.shortageAmount)} with ${forecast.cashRunwayDays} day(s) of runway.`,
    );
  } else {
    summaryParts.push(
      `No cash shortage is forecast in the next ${forecast.horizonDays} day(s); the lowest projected balance is ${formatRupees(forecast.minimumBalance)} on ${formatDateLabel(forecast.minimumBalanceDate)}.`,
    );
  }

  const comparison = adjustments !== undefined && adjustments.length > 0 ? compareScenario(dataset, adjustments) : null;

  return {
    asOfDate: asOf,
    source: "deterministic",
    providerStatus: "not_configured",
    summary: summaryParts.join(" "),
    metrics: {
      availableCash,
      outstandingReceivables,
      overdueReceivables,
      upcomingExpenses,
      expectedInflows,
      projectedMinimumBalance: forecast.minimumBalance,
      minimumBalanceDate: forecast.minimumBalanceDate,
      shortageDate: forecast.shortageDate,
      shortageAmount: forecast.shortageAmount,
      cashRunwayDays: forecast.cashRunwayDays,
      safetyBuffer: forecast.safetyBuffer,
      riskLevel: forecast.riskLevel,
    },
    risks: buildRiskItems(risks, forecast),
    actions: buildActions(dataset, forecast, risks, receivables),
    scenario: comparison === null ? null : buildScenarioAdvice(comparison),
  };
}
