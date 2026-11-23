/**
 * Deterministic risk engine for CASHFLOW AI.
 *
 * No LLM, no randomness, no Date.now(). The only clock is dataset.settings.asOfDate.
 * All money is integer paise. Only triggered findings are returned (no "all clear" entries).
 */

import type {
  Dataset,
  Expense,
  ForecastResult,
  Invoice,
  Payment,
  RiskFinding,
  RiskSeverity,
} from "../../../shared/types.js";
import { addDays, addMonthsClamped, compareIso, diffDays, isValidIsoDate } from "./dates.js";

/* ---------- Thresholds ---------- */

/** Cash runway (days until the projected balance first goes negative) below this raises "short-runway" when there is no shortage. */
export const RUNWAY_WARNING_DAYS = 14;

/** An open invoice overdue by at least this many days raises "severely-overdue". */
export const SEVERE_OVERDUE_DAYS = 30;

/** Overdue remaining receivables / total open remaining receivables, at or above this, raises "high-overdue-share". */
export const OVERDUE_SHARE_WARNING = 0.25;

/** One customer's expected inflows within the horizon / total expected inflows, at or above this, raises "customer-concentration". */
export const CONCENTRATION_SHARE_WARNING = 0.4;

/** Share of a customer's paid invoices paid after due date, at or above this, raises "repeatedly-late-customer". Needs >= 2 paid invoices with valid payment dates. */
export const LATE_PAYMENT_RATIO_WARNING = 0.5;

/** A single expense occurrence within the horizon >= this share of opening balance raises "large-upcoming-expense". Only when opening balance > 0. */
export const LARGE_EXPENSE_SHARE = 0.2;

const SEVERE_OVERDUE_CRITICAL_DAYS = 60;
const CONCENTRATION_CRITICAL_SHARE = 0.6;
const LATE_PAYMENT_HIGH_RATIO = 0.75;
const MIN_PAID_INVOICES_FOR_LATE_RATIO = 2;
const TRAILING_WINDOW_DAYS = 7;
const RECURRING_SHARE_OF_INFLOWS = 0.5;

const SEVERITY_RANK: Record<RiskSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** An open (not cancelled, remaining > 0) invoice with a valid due date. */
interface OpenInvoice {
  invoice: Invoice;
  customerId: string;
  customerName: string;
  remaining: number;
  dueDate: string;
  daysOverdue: number;
}

/** Money fields are in paise. */
function formatPaise(paise: number): string {
  const rounded = Math.round(paise);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}INR ${rupees}.${fraction}`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Days until the projected balance first drops below the safety buffer.
 * forecast.cashRunwayDays is days-to-negative; this is days-to-buffer-breach.
 * Returns forecast.days.length when no day is below the buffer.
 */
function daysUntilBelowBuffer(forecast: ForecastResult): number {
  const index = forecast.days.findIndex((day) => day.balance < forecast.safetyBuffer);
  return index === -1 ? forecast.days.length : index + 1;
}

/**
 * Occurrences of an expense that fall inside (asOf, horizonEnd].
 * Mirrors the forecast engine: weekly/monthly series are generated from the original dueDate
 * and stop at recurrenceEndDate; a non-recurring expense due on or before asOf is treated as due the day after.
 */
function occurrencesInHorizon(expense: Expense, asOf: string, horizonEnd: string): string[] {
  if (!isValidIsoDate(expense.dueDate) || !(expense.amount > 0)) {
    return [];
  }
  const endDate = isValidIsoDate(expense.recurrenceEndDate) ? expense.recurrenceEndDate : null;

  if (expense.recurrence === "weekly" || expense.recurrence === "monthly") {
    const result: string[] = [];
    for (let k = 0; ; k++) {
      const occurrence =
        expense.recurrence === "weekly" ? addDays(expense.dueDate, 7 * k) : addMonthsClamped(expense.dueDate, k);
      if (compareIso(occurrence, horizonEnd) > 0) break;
      if (endDate !== null && compareIso(occurrence, endDate) > 0) break;
      if (compareIso(occurrence, asOf) > 0) {
        result.push(occurrence);
      }
    }
    return result;
  }

  let occurrence = expense.dueDate;
  if (compareIso(occurrence, asOf) <= 0) {
    occurrence = addDays(asOf, 1);
  }
  return compareIso(occurrence, horizonEnd) <= 0 ? [occurrence] : [];
}

export function detectRisks(dataset: Dataset, forecast: ForecastResult): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const settings = dataset.settings;
  const asOf = settings.asOfDate;
  const horizonDays = forecast.horizonDays;
  const horizonEnd = addDays(asOf, horizonDays);
  const openingBalance = settings.openingBalance;

  const customerNames = new Map<string, string>();
  for (const customer of dataset.customers ?? []) {
    customerNames.set(customer.id, customer.name);
  }
  const nameOf = (customerId: string): string => customerNames.get(customerId) ?? customerId;

  /* ---------- CASH ---------- */

  if (forecast.shortageDate !== null) {
    findings.push({
      id: "cash-shortage",
      severity: "critical",
      category: "cash",
      title: "Cash shortage forecast",
      explanation: `The projected balance falls below zero on ${forecast.shortageDate}. The lowest point is ${formatPaise(forecast.minimumBalance)} on ${forecast.minimumBalanceDate}, a shortfall of ${formatPaise(forecast.shortageAmount)}.`,
      metrics: {
        shortageDate: forecast.shortageDate,
        shortageAmount: forecast.shortageAmount,
        minimumBalance: forecast.minimumBalance,
      },
      recommendedAction: `Before ${forecast.shortageDate}, collect the largest due or overdue invoices early or postpone upcoming expenses by enough to cover the ${formatPaise(forecast.shortageAmount)} gap.`,
    });
  }

  if (forecast.minimumBalance >= 0 && forecast.minimumBalance < forecast.safetyBuffer) {
    findings.push({
      id: "below-safety-buffer",
      severity: "high",
      category: "cash",
      title: "Balance falls below safety buffer",
      explanation: `The projected minimum balance is ${formatPaise(forecast.minimumBalance)} on ${forecast.minimumBalanceDate}, below the safety buffer of ${formatPaise(forecast.safetyBuffer)}. The balance stays non-negative but has little headroom.`,
      metrics: {
        minimumBalance: forecast.minimumBalance,
        minimumBalanceDate: forecast.minimumBalanceDate,
        safetyBuffer: forecast.safetyBuffer,
      },
      recommendedAction: `Keep at least ${formatPaise(forecast.safetyBuffer)} available by chasing collections due before ${forecast.minimumBalanceDate} or deferring non-essential spending in that window.`,
    });
  }

  // Fires when the balance breaches the safety buffer soon, even if it never goes negative.
  const breachesBuffer = forecast.days.some((day) => day.balance < forecast.safetyBuffer);
  if (forecast.shortageDate === null && breachesBuffer) {
    const runwayDays = daysUntilBelowBuffer(forecast);
    if (runwayDays < RUNWAY_WARNING_DAYS) {
      const breachDay = forecast.days[runwayDays - 1];
      const breachDate = breachDay.date;
      const shortfall = forecast.safetyBuffer - breachDay.balance;
      findings.push({
        id: "short-runway",
        severity: runwayDays <= 7 ? "high" : "medium",
        category: "cash",
        title: `Cash falls below safety buffer in ${runwayDays} day(s) on ${breachDate}`,
        explanation: `The projected balance drops below the safety buffer of ${formatPaise(forecast.safetyBuffer)} in ${runwayDays} day(s), on ${breachDate}, when it is ${formatPaise(shortfall)} under the buffer. No negative balance is projected within the ${horizonDays}-day horizon, but there is little margin.`,
        metrics: {
          runwayDays,
          bufferBreachDate: breachDate,
          safetyBuffer: forecast.safetyBuffer,
          minimumBalance: forecast.minimumBalance,
        },
        recommendedAction: `Before ${breachDate}, collect the largest open receivable due by then or defer the next large expense falling before ${breachDate} to keep at least ${formatPaise(forecast.safetyBuffer)} available.`,
      });
    }
  }

  const lastDay = forecast.days[forecast.days.length - 1];
  if (lastDay !== undefined && lastDay.balance < openingBalance) {
    const trailing = forecast.days.slice(-TRAILING_WINDOW_DAYS);
    const trailingIncoming = trailing.reduce((sum, day) => sum + day.incoming, 0);
    const trailingOutgoing = trailing.reduce((sum, day) => sum + day.outgoing, 0);
    if (trailingOutgoing > trailingIncoming) {
      findings.push({
        id: "declining-liquidity",
        severity: lastDay.balance < 0 ? "high" : "medium",
        category: "cash",
        title: "Liquidity is declining",
        explanation: `The balance is projected to end the horizon at ${formatPaise(lastDay.balance)}, down from ${formatPaise(openingBalance)} today. In the last ${trailing.length} day(s) outgoing payments (${formatPaise(trailingOutgoing)}) exceed incoming (${formatPaise(trailingIncoming)}).`,
        metrics: {
          openingBalance,
          endingBalance: lastDay.balance,
          trailingIncoming,
          trailingOutgoing,
        },
        recommendedAction: `Prioritise collection of open invoices and review the ${trailing.length} day(s) of heavy outflows to see which payments can be rescheduled.`,
      });
    }
  }

  /* ---------- RECEIVABLES ---------- */

  // Payments dated on or before asOf only, mirroring the forecast engine.
  const paidByInvoice = new Map<string, number>();
  const lastPaymentDateByInvoice = new Map<string, string>();
  for (const payment of (dataset.payments ?? []) as Payment[]) {
    if (!isValidIsoDate(payment.date) || !(payment.amount > 0)) continue;
    if (compareIso(payment.date, asOf) > 0) continue;
    paidByInvoice.set(payment.invoiceId, (paidByInvoice.get(payment.invoiceId) ?? 0) + payment.amount);
    const previous = lastPaymentDateByInvoice.get(payment.invoiceId);
    if (previous === undefined || compareIso(payment.date, previous) > 0) {
      lastPaymentDateByInvoice.set(payment.invoiceId, payment.date);
    }
  }

  const openInvoices: OpenInvoice[] = [];
  // Per customer: invoices fully settled with a dated payment, and how many of those were paid after due date.
  const paidStats = new Map<string, { paid: number; late: number }>();
  for (const invoice of (dataset.invoices ?? []) as Invoice[]) {
    if (invoice.status === "cancelled" || invoice.cancelled === true) continue;
    // Invoices with an invalid due date are skipped, as in the forecast engine.
    if (!isValidIsoDate(invoice.dueDate)) continue;

    const paid = paidByInvoice.get(invoice.id) ?? 0;
    const remaining = invoice.amount - paid;
    if (remaining > 0) {
      openInvoices.push({
        invoice,
        customerId: invoice.customerId,
        customerName: nameOf(invoice.customerId),
        remaining,
        dueDate: invoice.dueDate,
        daysOverdue: compareIso(invoice.dueDate, asOf) < 0 ? diffDays(invoice.dueDate, asOf) : 0,
      });
      continue;
    }

    const lastPaid = lastPaymentDateByInvoice.get(invoice.id);
    if (lastPaid === undefined) continue;
    const stats = paidStats.get(invoice.customerId) ?? { paid: 0, late: 0 };
    stats.paid += 1;
    if (compareIso(lastPaid, invoice.dueDate) > 0) {
      stats.late += 1;
    }
    paidStats.set(invoice.customerId, stats);
  }

  // severely-overdue: one finding for the worst invoice.
  let worst: OpenInvoice | null = null;
  for (const item of openInvoices) {
    if (item.daysOverdue >= SEVERE_OVERDUE_DAYS && (worst === null || item.daysOverdue > worst.daysOverdue)) {
      worst = item;
    }
  }
  if (worst !== null) {
    const severity: RiskSeverity = worst.daysOverdue >= SEVERE_OVERDUE_CRITICAL_DAYS ? "critical" : "high";
    findings.push({
      id: "severely-overdue",
      severity,
      category: "receivable",
      title: `Invoice ${worst.invoice.invoiceNumber} is ${worst.daysOverdue} days overdue`,
      explanation: `Invoice ${worst.invoice.invoiceNumber} from ${worst.customerName} is ${worst.daysOverdue} day(s) past its due date of ${worst.dueDate}, with ${formatPaise(worst.remaining)} still unpaid.`,
      metrics: {
        invoiceNumber: worst.invoice.invoiceNumber,
        customer: worst.customerName,
        daysOverdue: worst.daysOverdue,
        remaining: worst.remaining,
        dueDate: worst.dueDate,
      },
      recommendedAction: `Escalate invoice ${worst.invoice.invoiceNumber} with ${worst.customerName}: request payment of ${formatPaise(worst.remaining)} this week or agree a dated payment plan in writing.`,
    });
  }

  // high-overdue-share
  const totalOpen = openInvoices.reduce((sum, item) => sum + item.remaining, 0);
  const totalOverdue = openInvoices
    .filter((item) => item.daysOverdue > 0)
    .reduce((sum, item) => sum + item.remaining, 0);
  if (totalOpen > 0 && totalOverdue / totalOpen >= OVERDUE_SHARE_WARNING) {
    const overdueShare = totalOverdue / totalOpen;
    findings.push({
      id: "high-overdue-share",
      severity: "high",
      category: "receivable",
      title: "Large share of receivables overdue",
      explanation: `${formatPercent(overdueShare)} of open receivables (${formatPaise(totalOverdue)} of ${formatPaise(totalOpen)}) are past due, above the ${formatPercent(OVERDUE_SHARE_WARNING)} warning level.`,
      metrics: {
        overdueRemaining: totalOverdue,
        totalOpenRemaining: totalOpen,
        overdueShare,
      },
      recommendedAction: `Work the overdue list from largest to smallest and confirm a payment date for each overdue invoice this week.`,
    });
  }

  // repeatedly-late-customer: based only on recorded payment dates.
  for (const [customerId, stats] of paidStats) {
    if (stats.paid < MIN_PAID_INVOICES_FOR_LATE_RATIO) continue;
    const lateRatio = stats.late / stats.paid;
    if (lateRatio < LATE_PAYMENT_RATIO_WARNING) continue;
    const name = nameOf(customerId);
    findings.push({
      id: "repeatedly-late-customer",
      severity: lateRatio >= LATE_PAYMENT_HIGH_RATIO ? "high" : "medium",
      category: "receivable",
      title: `${name} repeatedly pays late`,
      explanation: `${name} paid ${stats.late} of ${stats.paid} settled invoices after the due date (${formatPercent(lateRatio)}). This is based on recorded payment dates only; invoices without a dated payment are not counted.`,
      metrics: {
        customer: name,
        paidInvoices: stats.paid,
        lateCount: stats.late,
        lateRatio,
      },
      recommendedAction: `Plan around ${name}'s historical lateness: confirm dates for their open invoices and consider earlier reminders or a shorter payment term on new invoices.`,
    });
  }

  /* ---------- CONCENTRATION ---------- */

  // Expected collections within the horizon, using the same rule as the forecast engine.
  const earliestCollection = addDays(asOf, 1);
  const expectedByCustomer = new Map<string, number>();
  let totalExpectedInflow = 0;
  for (const item of openInvoices) {
    const expected =
      compareIso(item.dueDate, asOf) >= 0
        ? addDays(item.dueDate, settings.defaultPaymentDelayDays)
        : addDays(asOf, settings.overdueCollectionDelayDays);
    const clamped = compareIso(expected, earliestCollection) < 0 ? earliestCollection : expected;
    if (compareIso(clamped, horizonEnd) > 0) continue;
    expectedByCustomer.set(item.customerId, (expectedByCustomer.get(item.customerId) ?? 0) + item.remaining);
    totalExpectedInflow += item.remaining;
  }

  let topCustomerId: string | null = null;
  let topInflow = 0;
  for (const [customerId, inflow] of expectedByCustomer) {
    if (inflow > topInflow) {
      topCustomerId = customerId;
      topInflow = inflow;
    }
  }
  if (topCustomerId !== null && totalExpectedInflow > 0) {
    const share = topInflow / totalExpectedInflow;
    if (share >= CONCENTRATION_SHARE_WARNING) {
      const name = nameOf(topCustomerId);
      // Exposure only: scenarios are not run here.
      findings.push({
        id: "customer-concentration",
        severity: share >= CONCENTRATION_CRITICAL_SHARE ? "critical" : "high",
        category: "concentration",
        title: `${name} is a concentrated source of inflows`,
        explanation: `${name} accounts for ${formatPercent(share)} (${formatPaise(topInflow)}) of the ${formatPaise(totalExpectedInflow)} expected to be collected within the ${horizonDays}-day horizon. Any late payment from ${name} lands directly on the forecast balance.`,
        metrics: {
          customer: name,
          share,
          expectedInflow: topInflow,
        },
        recommendedAction: `Confirm the expected payment date with ${name} for their open invoices and hold liquidity or a credit line in reserve in case their payment slips.`,
      });
    }
  }

  /* ---------- EXPENSES ---------- */

  // Note: expense.amount is used as stored. Scenario adjustments are NOT applied in the risk engine.
  let largest: { name: string; date: string; amount: number } | null = null;
  let recurringOutflow = 0;
  for (const expense of (dataset.expenses ?? []) as Expense[]) {
    for (const date of occurrencesInHorizon(expense, asOf, horizonEnd)) {
      if (expense.recurrence !== "none") {
        recurringOutflow += expense.amount;
      }
      if (openingBalance > 0 && expense.amount >= LARGE_EXPENSE_SHARE * openingBalance) {
        if (largest === null || expense.amount > largest.amount) {
          largest = { name: expense.name, date, amount: expense.amount };
        }
      }
    }
  }

  // large-upcoming-expense: one finding for the largest triggering occurrence.
  if (largest !== null) {
    const share = largest.amount / openingBalance;
    findings.push({
      id: "large-upcoming-expense",
      severity: "medium",
      category: "expense",
      title: `Large expense: ${largest.name}`,
      explanation: `${largest.name} of ${formatPaise(largest.amount)} is due on ${largest.date}, which is ${formatPercent(share)} of the opening balance of ${formatPaise(openingBalance)}.`,
      metrics: {
        expense: largest.name,
        dueDate: largest.date,
        amount: largest.amount,
        openingBalance,
        shareOfOpeningBalance: share,
      },
      recommendedAction: `Confirm the ${largest.name} payment on ${largest.date} is funded, or check whether it can be paid in instalments or postponed.`,
    });
  }

  const totalIncoming = forecast.days.reduce((sum, day) => sum + day.incoming, 0);
  const totalOutgoing = forecast.days.reduce((sum, day) => sum + day.outgoing, 0);

  // recurring-commitments
  if (recurringOutflow > 0 && recurringOutflow > RECURRING_SHARE_OF_INFLOWS * totalIncoming) {
    findings.push({
      id: "recurring-commitments",
      severity: "medium",
      category: "expense",
      title: "Recurring commitments are heavy relative to inflows",
      explanation: `Recurring expenses total ${formatPaise(recurringOutflow)} within the horizon, against expected inflows of ${formatPaise(totalIncoming)}. That is above the ${formatPercent(RECURRING_SHARE_OF_INFLOWS)} level, so little collection slippage can be absorbed.`,
      metrics: {
        recurringOutflow,
        totalInflows: totalIncoming,
        recurringShare: totalIncoming > 0 ? recurringOutflow / totalIncoming : null,
      },
      recommendedAction: `Review recurring expenses (rent, subscriptions, supplier retainers) for cuts or renegotiation, and avoid adding new recurring commitments until collections recover.`,
    });
  }

  // outflows-exceed-inflows
  if (totalOutgoing > totalIncoming) {
    findings.push({
      id: "outflows-exceed-inflows",
      severity: "high",
      category: "cash",
      title: "Outflows exceed inflows over the horizon",
      explanation: `Forecast outgoing payments of ${formatPaise(totalOutgoing)} exceed expected incoming receipts of ${formatPaise(totalIncoming)} over the ${horizonDays}-day horizon, a net outflow of ${formatPaise(totalOutgoing - totalIncoming)}.`,
      metrics: {
        totalOutflows: totalOutgoing,
        totalInflows: totalIncoming,
        netOutflow: totalOutgoing - totalIncoming,
      },
      recommendedAction: `Close the ${formatPaise(totalOutgoing - totalIncoming)} gap by accelerating collections and deferring discretionary expenses within the horizon.`,
    });
  }

  // Deterministic order: severity, then id, then title (titles disambiguate per-customer findings).
  findings.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return 0;
  });

  return findings;
}
