/**
 * Customer intelligence for CASHFLOW AI (Milestone 5). Pure functions, no I/O, no Date.now.
 *
 * Money is integer paise. Dates are "YYYY-MM-DD". Only payments dated on or before
 * settings.asOfDate are considered. A "settled" invoice is fully paid (balance 0, paid > 0)
 * with a valid due date; its delay is the days from due date to the payment that completed it.
 */

import type {
  CustomerClassification,
  CustomerIntelligence,
  Dataset,
  Invoice,
  Payment,
  RiskLevel,
} from "../../../shared/types.js";
import { compareIso, diffDays, isValidIsoDate } from "./dates.js";
import { toInvoiceView } from "./invoiceStatus.js";

export const MIN_SETTLED_INVOICES = 3;
export const CONCENTRATION_FLAG_SHARE = 0.4;
export const LATE_TOLERANCE_DAYS = 0;
export const SCORE_DELAY_CAP_DAYS = 60;

const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface CustomerAgg {
  outstanding: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  overdueCount: number;
  totalInvoices: number;
  settledDelays: number[];
}

function isCancelled(invoice: Invoice): boolean {
  return invoice.cancelled === true || invoice.status === "cancelled";
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Date of the earliest payment (payments pre-sorted by date, id) at which cumulative paid reaches the invoice amount. */
function completionDate(invoice: Invoice, sortedPayments: Payment[]): string | undefined {
  let cumulative = 0;
  for (const payment of sortedPayments) {
    cumulative += payment.amount;
    if (cumulative >= invoice.amount) return payment.date;
  }
  return undefined;
}

function classify(onTimeRatio: number, avgDelay: number): CustomerClassification {
  if (onTimeRatio >= 0.8 && avgDelay <= 3) return "reliable";
  if (onTimeRatio < 0.5 && avgDelay > 0) return "consistently_late";
  return "occasionally_late";
}

export function computeCustomerIntelligence(dataset: Dataset): CustomerIntelligence[] {
  const asOf = dataset.settings.asOfDate;

  const validPayments = dataset.payments
    .filter((p) => isValidIsoDate(p.date) && compareIso(p.date, asOf) <= 0 && p.amount > 0)
    .sort((a, b) => compareIso(a.date, b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const paymentsByInvoice = new Map<string, Payment[]>();
  for (const payment of validPayments) {
    const list = paymentsByInvoice.get(payment.invoiceId);
    if (list) list.push(payment);
    else paymentsByInvoice.set(payment.invoiceId, [payment]);
  }

  const aggs = new Map<string, CustomerAgg>();
  for (const customer of dataset.customers) {
    aggs.set(customer.id, {
      outstanding: 0,
      overdueAmount: 0,
      maxDaysOverdue: 0,
      overdueCount: 0,
      totalInvoices: 0,
      settledDelays: [],
    });
  }

  for (const invoice of dataset.invoices) {
    if (isCancelled(invoice)) continue;
    const agg = aggs.get(invoice.customerId);
    if (!agg) continue;

    const view = toInvoiceView(invoice, validPayments, asOf);
    agg.totalInvoices += 1;
    agg.outstanding += view.balance;
    if (view.status === "overdue") {
      agg.overdueCount += 1;
      agg.overdueAmount += view.balance;
      agg.maxDaysOverdue = Math.max(agg.maxDaysOverdue, view.daysOverdue);
    }

    if (view.balance === 0 && view.paidAmount > 0 && isValidIsoDate(invoice.dueDate)) {
      const completed = completionDate(invoice, paymentsByInvoice.get(invoice.id) ?? []);
      if (completed !== undefined) agg.settledDelays.push(diffDays(invoice.dueDate, completed));
    }
  }

  let totalOutstanding = 0;
  for (const agg of aggs.values()) totalOutstanding += agg.outstanding;

  const results: CustomerIntelligence[] = dataset.customers.map((customer) => {
    const agg = aggs.get(customer.id) as CustomerAgg;
    const settledCount = agg.settledDelays.length;
    const sufficient = settledCount >= MIN_SETTLED_INVOICES;

    let reliabilityScore: number | null = null;
    let onTimeRatio: number | null = null;
    let averagePaymentDelayDays: number | null = null;
    let classification: CustomerClassification = "insufficient_data";
    let reliabilityExplanation = `Insufficient data: ${settledCount} settled invoices, at least ${MIN_SETTLED_INVOICES} required`;

    if (sufficient) {
      const onTimeCount = agg.settledDelays.filter((d) => d <= LATE_TOLERANCE_DAYS).length;
      const ratioRaw = onTimeCount / settledCount;
      const meanDelay = agg.settledDelays.reduce((sum, d) => sum + d, 0) / settledCount;
      const avgDelay = round1(meanDelay);
      const overdueFraction = agg.totalInvoices > 0 ? agg.overdueCount / agg.totalInvoices : 0;

      const onTimePts = 50 * ratioRaw;
      const delayPts = 25 * (1 - Math.min(1, Math.max(0, avgDelay) / SCORE_DELAY_CAP_DAYS));
      const overduePts = 25 * (1 - overdueFraction);
      const score = Math.min(100, Math.max(0, Math.round(onTimePts + delayPts + overduePts)));

      onTimeRatio = round4(ratioRaw);
      averagePaymentDelayDays = avgDelay;
      reliabilityScore = score;
      classification = classify(ratioRaw, avgDelay);
      reliabilityExplanation =
        `Score ${score}: ${onTimeCount} of ${settledCount} settled invoices paid on time (${Math.round(onTimePts)} of 50 points); ` +
        `average delay ${avgDelay.toFixed(1)} days (${Math.round(delayPts)} of 25 points); ` +
        `${agg.overdueCount} of ${agg.totalInvoices} invoices overdue (${Math.round(overduePts)} of 25 points).`;
    }

    const concentrationShare = totalOutstanding > 0 ? round4(agg.outstanding / totalOutstanding) : 0;
    const concentrationFlag = concentrationShare >= CONCENTRATION_FLAG_SHARE && agg.outstanding > 0;

    const isLateClass = classification === "consistently_late" || classification === "occasionally_late";
    let riskLevel: RiskLevel = "low";
    if (agg.overdueAmount > 0 && agg.maxDaysOverdue >= 30) riskLevel = "critical";
    else if (agg.overdueAmount > 0 || concentrationFlag) riskLevel = "high";
    else if (isLateClass || (!sufficient && agg.outstanding > 0)) riskLevel = "medium";

    const riskReasons: string[] = [];
    if (agg.overdueAmount > 0) {
      riskReasons.push(`${agg.overdueAmount} paise overdue, max ${agg.maxDaysOverdue} days past due`);
    }
    if (concentrationFlag) {
      riskReasons.push(
        `Holds ${Math.round(concentrationShare * 100)}% of total outstanding (flag threshold ${Math.round(CONCENTRATION_FLAG_SHARE * 100)}%)`,
      );
    }
    if (isLateClass && averagePaymentDelayDays !== null && onTimeRatio !== null) {
      riskReasons.push(
        `Average payment delay ${averagePaymentDelayDays.toFixed(1)} days, ${Math.round(onTimeRatio * 100)}% of settled invoices on time`,
      );
    }
    if (!sufficient && agg.outstanding > 0) {
      riskReasons.push(`Insufficient history: ${settledCount} settled invoices`);
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      classification,
      reliabilityScore,
      reliabilityExplanation,
      settledInvoiceCount: settledCount,
      onTimeRatio,
      averagePaymentDelayDays,
      outstanding: agg.outstanding,
      overdueAmount: agg.overdueAmount,
      maxDaysOverdue: agg.maxDaysOverdue,
      concentrationShare,
      concentrationFlag,
      riskLevel,
      riskRank: 0,
      riskReasons,
    };
  });

  results.sort(
    (a, b) =>
      RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel] ||
      b.overdueAmount - a.overdueAmount ||
      b.outstanding - a.outstanding ||
      (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0),
  );

  return results.map((item, index) => ({ ...item, riskRank: index + 1 }));
}

export function customerIntelligenceFor(dataset: Dataset, customerId: string): CustomerIntelligence | undefined {
  return computeCustomerIntelligence(dataset).find((item) => item.customerId === customerId);
}
