/**
 * AI CFO chat (Milestone 6.1, intent upgrade M6.2).
 *
 * Deterministic answers come from buildChatContext: every number the chat may use is in a FACT line,
 * each fact line is built with formatRupees / formatDateLabel, and each fact starts with exactly one
 * tag: [actual], [forecast] or [scenario]. The optional LLM only rewords the deterministic answer; its
 * output is rejected unless every number it contains appears in the facts.
 * Money is integer paise; dates are "YYYY-MM-DD" internally and formatted for display. No new
 * calculations live here: figures come from forecastCashFlow, computeCustomerIntelligence,
 * openReceivables and compareScenario.
 */

import { z } from "zod";
import type {
  AiCfoAction,
  AiCfoBriefing,
  AiCfoChatBasis,
  AiCfoChatRequest,
  AiCfoChatResponse,
  CustomerClassification,
  CustomerIntelligence,
  Dataset,
  ForecastResult,
  ScenarioAdjustment,
  ScenarioComparison,
} from "../../../shared/types.js";
import { compareIso } from "../core/dates.js";
import { computeCustomerIntelligence } from "../core/customerIntelligence.js";
import { forecastCashFlow } from "../core/forecast.js";
import { openReceivables } from "../core/receivables.js";
import { compareScenario } from "../core/scenario.js";
import { buildDeterministicBriefing } from "./deterministic.js";
import { formatDateLabel, formatRupees } from "./facts.js";
import type { LlmProvider } from "./llm.js";
import { noPaymentPredictions, type PaymentPredictionSource } from "./predictionBoundary.js";

export const CHAT_MAX_MESSAGE_CHARS = 500;
export const CHAT_MAX_HISTORY = 10;

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ANSWER_CHARS = 1200;
const TOP_CUSTOMER_FACTS = 3;
const TOP_ACTIONS = 3;
const TOP_RISK_CUSTOMERS = 4;

export type ChatIntent =
  | "cash_position"
  | "shortage"
  | "today_actions"
  | "collection_priority"
  | "customer_risk"
  | "scenario"
  | "expense_affordability"
  | "prevention"
  | "general"
  | "forecast"
  | "receivables";

export interface ChatContext {
  briefing: AiCfoBriefing;
  forecast: ForecastResult;
  intelligence: CustomerIntelligence[];
  comparison: ScenarioComparison | null;
  facts: string[];
}

const CLASS_LABEL: Record<CustomerClassification, string> = {
  reliable: "reliable",
  occasionally_late: "occasionally late",
  consistently_late: "consistently late",
  insufficient_data: "insufficient data",
};

const FACT_TAG = /^\[(actual|forecast|scenario)\] \S/;

/* ---------- Formatting helpers (every number in an answer is taken from these) ---------- */

function dayCount(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function dateOrNone(date: string | null): string {
  return date === null ? "none" : formatDateLabel(date);
}

function reliabilityLabel(customer: CustomerIntelligence): string {
  if (customer.reliabilityScore === null || customer.classification === "insufficient_data") {
    return "Insufficient data";
  }
  return CLASS_LABEL[customer.classification];
}

function overdueCustomers(intelligence: CustomerIntelligence[]): CustomerIntelligence[] {
  return intelligence.filter((c) => c.overdueAmount > 0).sort((a, b) => a.riskRank - b.riskRank);
}

function byRank(a: CustomerIntelligence, b: CustomerIntelligence): number {
  return a.riskRank - b.riskRank;
}

/** Drops empty, undefined and untagged entries. Every fact that reaches an answer passes through here. */
function cleanFacts(facts: ReadonlyArray<string | undefined | null>): string[] {
  return facts.filter((f): f is string => typeof f === "string" && FACT_TAG.test(f));
}

function tagOf(fact: string): string {
  return FACT_TAG.exec(fact)?.[1] ?? "";
}

/**
 * Basis follows the cited facts. A scenario answer is a scenario answer (the scenario is the main content).
 * Otherwise one tag gives that basis, several give "mixed", and no facts gives "actual".
 */
function basisOf(intent: ChatIntent, facts: string[]): AiCfoChatBasis {
  if (intent === "scenario" || facts.some((f) => tagOf(f) === "scenario")) return "scenario";
  const tags = new Set(facts.map(tagOf));
  if (tags.size === 0) return "actual";
  if (tags.size === 1) return [...tags][0] as AiCfoChatBasis;
  return "mixed";
}

/* ---------- Fact lines ---------- */

function cashLine(b: AiCfoBriefing): string {
  return `[actual] Available cash ${formatRupees(b.metrics.availableCash)} as of ${formatDateLabel(b.asOfDate)}`;
}

function receivablesLine(b: AiCfoBriefing): string {
  const m = b.metrics;
  return `[actual] Receivables outstanding ${formatRupees(m.outstandingReceivables)}, of which ${formatRupees(m.overdueReceivables)} is overdue`;
}

function minimumLine(b: AiCfoBriefing): string {
  const m = b.metrics;
  return `[forecast] Projected minimum balance ${formatRupees(m.projectedMinimumBalance)} on ${formatDateLabel(m.minimumBalanceDate)}`;
}

function shortageLine(b: AiCfoBriefing): string {
  const m = b.metrics;
  if (m.shortageDate === null) return "[forecast] No cash shortage is forecast within the forecast horizon";
  return `[forecast] Cash shortage of ${formatRupees(m.shortageAmount)} starts ${formatDateLabel(m.shortageDate)}, with ${dayCount(m.cashRunwayDays)} of runway`;
}

function flowsLine(b: AiCfoBriefing): string {
  const m = b.metrics;
  return `[forecast] Expected inflows ${formatRupees(m.expectedInflows)} against upcoming expenses ${formatRupees(m.upcomingExpenses)} within the forecast horizon`;
}

function bufferLine(b: AiCfoBriefing): string {
  return `[forecast] Safety buffer ${formatRupees(b.metrics.safetyBuffer)}`;
}

function openingLine(forecast: ForecastResult): string {
  return `[forecast] Opening cash ${formatRupees(forecast.openingBalance)} as of ${formatDateLabel(forecast.asOfDate)}`;
}

function customerOverdueLine(c: CustomerIntelligence): string {
  return `[actual] ${c.customerName} has ${formatRupees(c.overdueAmount)} overdue, up to ${dayCount(c.maxDaysOverdue)} past due; reliability: ${reliabilityLabel(c)}.`;
}

function customerOutstandingLine(c: CustomerIntelligence): string {
  return `[actual] ${c.customerName} has ${formatRupees(c.outstanding)} outstanding; reliability: ${reliabilityLabel(c)}.`;
}

function reliabilityLine(c: CustomerIntelligence): string {
  return `[actual] ${c.customerName} reliability: ${reliabilityLabel(c)}.`;
}

function customerRiskLine(c: CustomerIntelligence): string {
  if (c.classification === "insufficient_data") {
    return `[actual] ${c.customerName}: insufficient history (${c.settledInvoiceCount} settled invoices); reliability: Insufficient data.`;
  }
  return `[actual] ${c.customerName} risk level ${c.riskLevel}; reliability: ${reliabilityLabel(c)}.`;
}

function concentrationLine(c: CustomerIntelligence): string {
  return `[forecast] ${c.customerName} makes up ${pct(c.concentrationShare)} of expected inflows`;
}

function actionLine(action: AiCfoAction): string {
  const basis = action.id.startsWith("collect-overdue") ? "actual" : "forecast";
  const stake = action.expectedImpact > 0 ? ` Cash at stake: ${formatRupees(action.expectedImpact)}.` : "";
  return `[${basis}] ${action.title}: ${action.detail}${stake}`;
}

/** Shortage date is reported only when it changed; an unchanged date is stated as unchanged. */
function scenarioShortageFact(label: string, c: ScenarioComparison): string {
  if (c.shortageDateBefore === c.shortageDateAfter) return `[scenario] ${label}: shortage date unchanged`;
  return `[scenario] ${label}: shortage date moves from ${dateOrNone(c.shortageDateBefore)} to ${dateOrNone(c.shortageDateAfter)}`;
}

function scenarioLines(label: string, c: ScenarioComparison): string[] {
  return [
    `[scenario] ${label}: projected minimum balance ${formatRupees(c.scenario.minimumBalance)} on ${formatDateLabel(c.scenario.minimumBalanceDate)}`,
    scenarioShortageFact(label, c),
  ];
}

/* ---------- Context ---------- */

/** Fact lines for the chat: the only source of numbers the chat may use. */
export function buildChatContext(dataset: Dataset, adjustments?: ScenarioAdjustment[]): ChatContext {
  const briefing = buildDeterministicBriefing(dataset, adjustments);
  const forecast = forecastCashFlow(dataset);
  const intelligence = computeCustomerIntelligence(dataset);
  const comparison = adjustments !== undefined && adjustments.length > 0 ? compareScenario(dataset, adjustments) : null;

  const facts: Array<string | undefined> = [
    cashLine(briefing),
    receivablesLine(briefing),
    minimumLine(briefing),
    shortageLine(briefing),
    flowsLine(briefing),
    bufferLine(briefing),
  ];
  for (const customer of overdueCustomers(intelligence).slice(0, TOP_CUSTOMER_FACTS)) {
    facts.push(customerOverdueLine(customer));
  }
  for (const customer of intelligence) {
    if (customer.concentrationFlag) facts.push(concentrationLine(customer));
  }
  for (const action of briefing.actions) {
    facts.push(actionLine(action));
  }
  if (comparison !== null) {
    facts.push(`[forecast] Baseline projected minimum balance ${formatRupees(comparison.baseline.minimumBalance)}`);
    facts.push(...scenarioLines("Adjusted case", comparison));
  }
  return { briefing, forecast, intelligence, comparison, facts: cleanFacts(facts) };
}

/* ---------- Intent ---------- */

/**
 * Word-boundary rules on the lower-cased question. Checked in order; the first match wins.
 * `hasAdjustments` is true when the request carries scenario adjustments; those always route to scenario.
 */
export function classifyIntent(question: string, hasAdjustments = false): ChatIntent {
  const q = question.toLowerCase();
  const test = (re: RegExp): boolean => re.test(q);

  const scenarioCue = /\bwhat if\b|\bwhat happens\b|\bif\b/;
  const scenarioTiming = /\blate\b|\blater\b|\bdelay(ed)?\b|\bpays?\b|\bpaid\b|\bpostpone\b|\bdefer\b|\bearly\b/;
  if (hasAdjustments || (test(scenarioCue) && test(scenarioTiming))) return "scenario";

  if (test(/\bafford|\bcan i (pay|buy|spend|take)\b|\bupcoming expenses?\b|\bnew expense\b|\bpurchase\b|\bexpenses? (can|will)\b/)) {
    return "expense_affordability";
  }
  if (test(/\bprevent|\bavoid|\bstop/) && test(/\bshortage|\bdeficit|\bgap\b|\brun out|\brunning out/)) return "prevention";
  if (test(/\brun out\b|\brunning out\b|\bruns out\b|\bshortage|\bout of money\b|\bwhy\b.*\b(cash|money|risk)\b/)) return "shortage";
  if (test(/\bcontact\b|\bcollect\b|\bchase\b|\bfollow up\b|\bwho should i (collect|contact|call|chase)\b/)) {
    return "collection_priority";
  }
  if (test(/\brisky\b|\brisks?\b|\breliab\w*|\blate payers?\b|\bconcentrat\w*|\bdepend\w*|\bwhich customers?\b/)) {
    return "customer_risk";
  }
  if (test(/\breceivables?\b|\bowed?\b|\byet to pay\b|\bowing\b|\boutstanding\b|\bunpaid\b|\boverdue\b|\bcustomers? (owe|pay)\b|\bhow much .*\bpay\b/)) {
    return "receivables";
  }
  if (test(/\btoday\b|\bthis week\b|\bshould i do\b|\bwhat should\b|\bnext step\b|\bimprove\b|\baction\b|\brecommend\w*|\bhow can i\b|\bhow do i\b|\bhow to\b|\bfix\b|\bsolve\b|\bwhat can i do\b/)) {
    return "today_actions";
  }
  if (test(/\bforecast\b|\bnext (week|month)\b|\boutlook\b|\bprojection\b|\blook like\b|\bfuture\b|\b30 days\b|\bcoming (weeks|days|month)\b/)) {
    return "forecast";
  }
  if (test(/\bcash\b|\bbalance\b|\bavailable\b|\bposition\b|\bhave\b/)) return "cash_position";
  return "general";
}

/* ---------- Deterministic answers ---------- */

function respond(intent: ChatIntent, answer: string, facts: Array<string | undefined>): AiCfoChatResponse {
  const cited = cleanFacts(facts);
  return {
    answer,
    source: "deterministic",
    providerStatus: "not_configured",
    basis: basisOf(intent, cited),
    intent,
    facts: cited,
  };
}

/** Largest single outgoing day on or before the shortage date; ties resolve to the earliest date. */
function largestOutflowBefore(forecast: ForecastResult, shortageDate: string): { date: string; amount: number } | null {
  let largest: { date: string; amount: number } | null = null;
  for (const day of forecast.days) {
    if (compareIso(day.date, shortageDate) > 0) break;
    if (day.outgoing > 0 && (largest === null || day.outgoing > largest.amount)) {
      largest = { date: day.date, amount: day.outgoing };
    }
  }
  return largest;
}

/** Rupee amount from the question: "₹50,000" first, otherwise the first bare number of at least 1000. Returns rupees. */
function parseRupees(question: string): number | null {
  const symbol = /₹\s?([\d,]+)/.exec(question);
  if (symbol !== null) {
    const n = Number((symbol[1] ?? "").replace(/,/g, ""));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  for (const match of question.matchAll(/\b\d[\d,]*\b/g)) {
    const n = Number(match[0].replace(/,/g, ""));
    if (Number.isSafeInteger(n) && n >= 1000) return n;
  }
  return null;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function scenarioResponse(intent: ChatIntent, label: string, comparison: ScenarioComparison): AiCfoChatResponse {
  const changed = comparison.shortageDateBefore !== comparison.shortageDateAfter;
  const shortageSentence = changed
    ? `The shortage date moves from ${dateOrNone(comparison.shortageDateBefore)} to ${dateOrNone(comparison.shortageDateAfter)}.`
    : "The shortage date is unchanged.";
  const answer =
    `Hypothetical scenario (${label}): the projected minimum balance moves from ` +
    `${formatRupees(comparison.baseline.minimumBalance)} to ${formatRupees(comparison.scenario.minimumBalance)}, ` +
    `lowest on ${formatDateLabel(comparison.scenario.minimumBalanceDate)}. ${shortageSentence}`;
  return respond(intent, answer, [
    `[forecast] Baseline projected minimum balance ${formatRupees(comparison.baseline.minimumBalance)} on ${formatDateLabel(comparison.baseline.minimumBalanceDate)}`,
    ...scenarioLines(label, comparison),
  ]);
}

export function answerDeterministically(
  question: string,
  dataset: Dataset,
  adjustments?: ScenarioAdjustment[],
): AiCfoChatResponse {
  const hasAdjustments = adjustments !== undefined && adjustments.length > 0;
  const intent = classifyIntent(question, hasAdjustments);
  const ctx = buildChatContext(dataset, adjustments);
  const b = ctx.briefing;
  const m = b.metrics;
  const forecast = ctx.forecast;
  const horizon = forecast.horizonDays;

  switch (intent) {
    case "shortage": {
      if (m.shortageDate === null) {
        return respond(
          intent,
          `No cash shortage is forecast within the forecast horizon. The lowest projected balance is ${formatRupees(m.projectedMinimumBalance)} on ${formatDateLabel(m.minimumBalanceDate)}.`,
          [minimumLine(b)],
        );
      }
      const sentences = [
        `Cash runs short on ${formatDateLabel(m.shortageDate)}: the projected gap is ${formatRupees(m.shortageAmount)}, with ${dayCount(m.cashRunwayDays)} of runway before the balance goes negative.`,
        `The lowest projected balance is ${formatRupees(m.projectedMinimumBalance)} on ${formatDateLabel(m.minimumBalanceDate)}.`,
      ];
      const facts: Array<string | undefined> = [shortageLine(b), minimumLine(b)];
      const largest = largestOutflowBefore(forecast, m.shortageDate);
      if (largest !== null) {
        sentences.push(
          `The largest single outflow on or before ${formatDateLabel(m.shortageDate)} is ${formatRupees(largest.amount)} on ${formatDateLabel(largest.date)}.`,
        );
        facts.push(`[forecast] Largest outflow on or before ${formatDateLabel(m.shortageDate)}: ${formatRupees(largest.amount)} on ${formatDateLabel(largest.date)}`);
      }
      const overdue = overdueCustomers(ctx.intelligence).slice(0, TOP_CUSTOMER_FACTS);
      if (overdue.length > 0) {
        sentences.push(
          `Overdue customers, by risk rank: ${overdue.map((c) => `${c.customerName} (${formatRupees(c.overdueAmount)} overdue)`).join(", ")}.`,
        );
        facts.push(...overdue.map(customerOverdueLine));
      }
      return respond(intent, sentences.join(" "), facts);
    }

    case "forecast": {
      const pressure = forecast.days.find((day) => day.balance < forecast.safetyBuffer);
      const pressureSentence =
        pressure !== undefined
          ? `pressure begins on ${formatDateLabel(pressure.date)}, when the balance falls below the ${formatRupees(forecast.safetyBuffer)} safety buffer`
          : `no pressure in the forecast window`;
      const answer =
        `Opening cash is ${formatRupees(forecast.openingBalance)} as of ${formatDateLabel(forecast.asOfDate)}. ` +
        `Over the forecast horizon, expected inflows are ${formatRupees(m.expectedInflows)} against upcoming expenses of ${formatRupees(m.upcomingExpenses)}. ` +
        `The lowest projected balance is ${formatRupees(m.projectedMinimumBalance)} on ${formatDateLabel(m.minimumBalanceDate)}, and ${pressureSentence}.`;
      return respond(intent, answer, [
        openingLine(forecast),
        flowsLine(b),
        minimumLine(b),
        bufferLine(b),
        pressure !== undefined
          ? `[forecast] Balance first falls below the safety buffer on ${formatDateLabel(pressure.date)}`
          : `[forecast] No projected balance falls below the safety buffer in the ${horizon}-day window`,
      ]);
    }

    case "today_actions": {
      const top = b.actions.slice(0, TOP_ACTIONS);
      if (top.length === 0) return respond(intent, "No action is required today.", []);
      const lines = top.map((action, index) => {
        const stake = action.expectedImpact > 0 ? `, with ${formatRupees(action.expectedImpact)} of cash at stake` : "";
        return `${index + 1}. ${action.title}${stake}.`;
      });
      return respond(intent, ["Your priority actions:", ...lines].join("\n"), top.map(actionLine));
    }

    case "prevention": {
      if (m.shortageDate === null) {
        return respond(
          intent,
          `No shortage is forecast, so no prevention step is needed. The lowest projected balance is ${formatRupees(m.projectedMinimumBalance)} on ${formatDateLabel(m.minimumBalanceDate)}.`,
          [minimumLine(b)],
        );
      }
      const steps = b.actions.filter((a) => a.id === "protect-shortage" || a.id === "defer-largest-expense");
      if (steps.length === 0) {
        return respond(
          intent,
          `The shortage starts on ${formatDateLabel(m.shortageDate)}. The briefing lists no prevention step.`,
          [shortageLine(b)],
        );
      }
      const lines = steps.map((a, index) => `${index + 1}. ${a.title}. ${a.detail}`);
      return respond(
        intent,
        ["Prevention steps before the shortage:", ...lines].join("\n"),
        [shortageLine(b), ...steps.map(actionLine)],
      );
    }

    case "collection_priority": {
      const top = overdueCustomers(ctx.intelligence)[0];
      if (top !== undefined) {
        return respond(
          intent,
          `Contact ${top.customerName} first: ${formatRupees(top.overdueAmount)} is overdue, up to ${dayCount(top.maxDaysOverdue)} past due, out of ${formatRupees(top.outstanding)} outstanding. Reliability: ${reliabilityLabel(top)}.`,
          [customerOverdueLine(top), customerOutstandingLine(top)],
        );
      }
      const largest = ctx.intelligence
        .filter((c) => c.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding)[0];
      if (largest === undefined) return respond(intent, "No customer has an open balance.", []);
      return respond(
        intent,
        `Nothing is overdue. ${largest.customerName} has the largest outstanding balance, ${formatRupees(largest.outstanding)} (not overdue). Reliability: ${reliabilityLabel(largest)}.`,
        [customerOutstandingLine(largest)],
      );
    }

    case "customer_risk": {
      if (ctx.intelligence.length === 0) return respond(intent, "No customer data is available.", []);
      const ranked = [...ctx.intelligence].sort(byRank);
      const flagged = ranked
        .filter((c) => c.riskLevel === "high" || c.riskLevel === "critical" || c.concentrationFlag)
        .slice(0, TOP_RISK_CUSTOMERS);
      if (flagged.length === 0) {
        const top = ranked[0];
        if (top === undefined) return respond(intent, "No customer data is available.", []);
        return respond(
          intent,
          `No customer is rated high or critical risk, and none exceeds the concentration threshold. The top-ranked customer, ${top.customerName}, is rated: ${reliabilityLabel(top)}.`,
          [reliabilityLine(top)],
        );
      }
      const sentences: string[] = [];
      const facts: Array<string | undefined> = [];
      for (const c of flagged) {
        if (c.classification === "insufficient_data") {
          sentences.push(`${c.customerName} has insufficient history (${c.settledInvoiceCount} settled invoices), so no payment pattern can be judged.`);
        } else if (c.riskLevel === "high" || c.riskLevel === "critical") {
          sentences.push(`${c.customerName} is rated ${c.riskLevel} risk (reliability: ${reliabilityLabel(c)}).`);
        }
        if (c.concentrationFlag) {
          sentences.push(`${c.customerName} makes up ${pct(c.concentrationShare)} of expected inflows, above the concentration threshold.`);
          facts.push(concentrationLine(c));
        }
        facts.push(customerRiskLine(c));
      }
      return respond(intent, sentences.join(" "), facts);
    }

    case "receivables": {
      const open = openReceivables(dataset, dataset.settings.asOfDate).filter((r) => r.remaining > 0);
      const count = open.length;
      const notDue = m.outstandingReceivables - m.overdueReceivables;
      const concentrated = ctx.intelligence
        .filter((c) => c.concentrationFlag)
        .sort((a, b) => b.concentrationShare - a.concentrationShare)[0];
      const sentences = [
        `Customers owe ${formatRupees(m.outstandingReceivables)} in total across ${count} open invoice${count === 1 ? "" : "s"}.`,
        `${formatRupees(m.overdueReceivables)} is overdue and ${formatRupees(notDue)} is not yet due.`,
      ];
      const facts: Array<string | undefined> = [
        receivablesLine(b),
        `[actual] Not yet due receivables ${formatRupees(notDue)} across ${count} open invoice${count === 1 ? "" : "s"}`,
      ];
      if (concentrated !== undefined) {
        sentences.push(`${concentrated.customerName} is the largest concentration, at ${pct(concentrated.concentrationShare)} of expected inflows.`);
        facts.push(concentrationLine(concentrated));
      }
      return respond(intent, sentences.join(" "), facts);
    }

    case "scenario": {
      if (ctx.comparison !== null) return scenarioResponse(intent, "the adjusted case", ctx.comparison);

      const q = question.toLowerCase();
      const customer = [...dataset.customers]
        .filter((c) => q.includes(c.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (customer === undefined) {
        return respond(
          intent,
          "I could not find a customer with that name in your data, so this scenario cannot be run here. Name the customer exactly as it appears, or test the case in the Scenario Simulator.",
          [],
        );
      }
      const dayMatch = /(\d+)\s*days?/.exec(q);
      if (dayMatch === null) {
        return respond(
          intent,
          `To run this scenario for ${customer.name}, state how many days late they pay. You can also test it in the Scenario Simulator.`,
          [],
        );
      }
      const days = Number(dayMatch[1]);
      const comparison = compareScenario(dataset, [{ type: "customer_delay", customerId: customer.id, days }]);
      return scenarioResponse(intent, `${customer.name} paying ${dayCount(days)} late`, comparison);
    }

    case "expense_affordability": {
      const rupees = parseRupees(question);
      if (rupees === null) {
        const facts: Array<string | undefined> = [
          minimumLine(b),
          `[forecast] Upcoming expenses ${formatRupees(m.upcomingExpenses)} within the ${horizon}-day horizon`,
          m.shortageDate !== null ? shortageLine(b) : undefined,
        ];
        return respond(
          intent,
          `The projected minimum balance is ${formatRupees(m.projectedMinimumBalance)} on ${formatDateLabel(m.minimumBalanceDate)}, and upcoming expenses total ${formatRupees(m.upcomingExpenses)}. Tell me the amount you are considering so I can test it against the forecast.`,
          facts,
        );
      }
      const amount = Math.round(rupees * 100);
      const paymentDate = addDays(dataset.settings.asOfDate, 1);
      const comparison = compareScenario(dataset, [
        { type: "new_expense", name: "Proposed expense", amount, date: paymentDate, recurrence: "none" },
      ]);
      const label = `Proposed expense of ${formatRupees(amount)}, assumed paid on ${formatDateLabel(paymentDate)}`;
      const scn = comparison.scenario;
      let shortageSentence: string;
      let shortageFact: string;
      if (comparison.shortageDateAfter === null) {
        shortageSentence = "No shortage appears.";
        shortageFact = `[scenario] ${label}: no shortage is forecast`;
      } else if (comparison.shortageDateBefore === null) {
        shortageSentence = `A shortage of ${formatRupees(comparison.shortageAmountAfter)} appears on ${formatDateLabel(comparison.shortageDateAfter)}.`;
        shortageFact = `[scenario] ${label}: shortage of ${formatRupees(comparison.shortageAmountAfter)} starts ${formatDateLabel(comparison.shortageDateAfter)}`;
      } else {
        shortageSentence =
          comparison.shortageDateBefore === comparison.shortageDateAfter
            ? "The shortage date is unchanged."
            : `The shortage date moves from ${formatDateLabel(comparison.shortageDateBefore)} to ${formatDateLabel(comparison.shortageDateAfter)}.`;
        shortageFact = scenarioShortageFact(label, comparison);
      }
      return respond(
        intent,
        `Hypothetical: assuming the expense is paid on ${formatDateLabel(paymentDate)}, the projected minimum balance becomes ${formatRupees(scn.minimumBalance)} on ${formatDateLabel(scn.minimumBalanceDate)}. ${shortageSentence}`,
        [
          `[scenario] ${label}: projected minimum balance ${formatRupees(scn.minimumBalance)} on ${formatDateLabel(scn.minimumBalanceDate)}`,
          shortageFact,
          minimumLine(b),
        ],
      );
    }

    case "cash_position": {
      const last = forecast.days[forecast.days.length - 1];
      const endSentence =
        last !== undefined
          ? ` The estimated balance at the end of the forecast is ${formatRupees(last.balance)} on ${formatDateLabel(last.date)}; this is an estimate.`
          : "";
      return respond(
        intent,
        `Available cash is ${formatRupees(m.availableCash)} as of ${formatDateLabel(b.asOfDate)}. Outstanding receivables of ${formatRupees(m.outstandingReceivables)} are not cash until they are collected.${endSentence}`,
        [
          cashLine(b),
          receivablesLine(b),
          last !== undefined
            ? `[forecast] Estimated balance at the end of the forecast ${formatRupees(last.balance)} on ${formatDateLabel(last.date)}`
            : undefined,
        ],
      );
    }

    case "general": {
      return respond(intent, b.summary, [
        cashLine(b),
        receivablesLine(b),
        m.shortageDate !== null ? shortageLine(b) : minimumLine(b),
      ]);
    }
  }
}

/* ---------- Optional provider wording ---------- */

const SYSTEM_PROMPT = [
  "You are the AI CFO assistant for a small business cash-flow dashboard.",
  "Answer only from the FACT lines in the user message.",
  "Do not calculate, estimate or invent any numbers, dates, customers or invoices.",
  "Copy every amount, date and name exactly as written in the facts, including the rupee symbol and digit grouping.",
  "Label any hypothetical or what-if statement as a scenario.",
  'Reply only with a JSON object of the form {"answer": string}.',
].join(" ");

const chatOutputSchema = z.object({ answer: z.string().min(1).max(MAX_ANSWER_CHARS) });

const NUMBER_TOKEN = /\d+(?:\.\d+)?/g;

/** Every numeric token in `text`, after commas are removed. */
function numericTokens(text: string): number[] {
  return Array.from(text.replace(/,/g, "").matchAll(NUMBER_TOKEN), (match) => Number(match[0]));
}

export interface ChatOptions {
  provider?: LlmProvider | null;
  timeoutMs?: number;
  /**
   * Payment-prediction source for Milestone 7, which will feed it as [prediction] facts.
   * Accepted now but not read by any answer, so passing it cannot change an answer.
   */
  predictionSource?: PaymentPredictionSource;
}

export async function answerChat(
  dataset: Dataset,
  req: AiCfoChatRequest,
  options: ChatOptions = {},
): Promise<AiCfoChatResponse> {
  const deterministic = answerDeterministically(req.message, dataset, req.adjustments);
  // Accepted for M7; intentionally unused in answers (see ChatOptions.predictionSource).
  const predictionSource: PaymentPredictionSource = options.predictionSource ?? noPaymentPredictions;
  void predictionSource;

  const provider = options.provider;
  if (provider === null || provider === undefined) return deterministic;

  const history = (req.history ?? []).slice(-CHAT_MAX_HISTORY);
  const userContent = JSON.stringify({
    question: req.message,
    intent: deterministic.intent,
    facts: deterministic.facts,
    history,
  });

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("LLM provider timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });

  let raw: string;
  try {
    raw = await Promise.race([provider.complete(SYSTEM_PROMPT, userContent, controller.signal), timeout]);
  } catch {
    return { ...deterministic, providerStatus: "unavailable" };
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...deterministic, providerStatus: "invalid_output" };
  }
  const result = chatOutputSchema.safeParse(parsed);
  if (!result.success) return { ...deterministic, providerStatus: "invalid_output" };

  // Number guard: every figure in the AI answer must appear in the fact lines used for this answer.
  const allowed = new Set(numericTokens(deterministic.facts.join(" ")));
  const answer = result.data.answer;
  // List numerals ("1. ", "2. ") at the start of a line are formatting, not figures; they are not checked.
  const figures = answer.replace(/^\s*\d+\.\s/gm, "");
  if (numericTokens(figures).some((token) => !allowed.has(token))) {
    return { ...deterministic, providerStatus: "invalid_output" };
  }

  return { ...deterministic, answer, source: "ai", providerStatus: "ok" };
}
