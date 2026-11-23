/**
 * Smart collections for CASHFLOW AI (Milestone 7). Pure functions, no I/O, no Date.now.
 *
 * Queue = non-cancelled invoices with balance > 0 and daysOverdue > 0 (from toInvoiceView).
 * Money is integer paise. Dates are "YYYY-MM-DD".
 *
 * Priority score (integer 0..100) = overdue age (max 40) + share of total overdue (max 30)
 *   + reliability (max 20; unknown history = 15) + customer exposure to total overdue (max 10).
 */

import type {
  CollectionPriority,
  CollectionQueueItem,
  CollectionsSummary,
  CustomerIntelligence,
  Dataset,
  Invoice,
  InvoiceView,
  Payment,
} from "../../../shared/types.js";
import { formatRupees } from "../ai/facts.js";
import { computeCustomerIntelligence } from "./customerIntelligence.js";
import { compareIso, isValidIsoDate } from "./dates.js";
import { toInvoiceView } from "./invoiceStatus.js";

const UNKNOWN_RELIABILITY_POINTS = 15;

interface ScoredItem {
  item: CollectionQueueItem;
  score: number;
}

function isCancelled(invoice: Invoice): boolean {
  return invoice.cancelled === true || invoice.status === "cancelled";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priorityFor(score: number): CollectionPriority {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function reliabilityPoints(reliabilityScore: number | null): number {
  if (reliabilityScore === null) return UNKNOWN_RELIABILITY_POINTS;
  return Math.round(((100 - reliabilityScore) / 100) * 20);
}

function buildReasons(
  view: InvoiceView,
  score: number,
  intel: CustomerIntelligence | undefined,
  customerOverdueAmount: number,
  customerOverdueCount: number,
): string[] {
  const reasons = [`Priority score ${score}/100`, `${view.daysOverdue} days past due`, `${formatRupees(view.balance)} overdue on this invoice`];

  if (intel?.reliabilityScore === null || intel === undefined) {
    reasons.push(`Insufficient payment history (${intel?.settledInvoiceCount ?? 0} settled invoices)`);
  } else {
    reasons.push(`Payment reliability ${intel.reliabilityScore}/100 (${intel.classification})`);
  }

  if (intel?.concentrationFlag) {
    reasons.push(`Customer holds ${Math.round(intel.concentrationShare * 100)}% of total outstanding`);
  }
  if (customerOverdueCount > 1) {
    reasons.push(`Customer has ${formatRupees(customerOverdueAmount)} overdue across ${customerOverdueCount} invoices`);
  }
  return reasons;
}

export function buildCollectionsSummary(dataset: Dataset): CollectionsSummary {
  const asOf = dataset.settings.asOfDate;
  const payments = ((dataset.payments ?? []) as Payment[]).filter(
    (p) => isValidIsoDate(p.date) && compareIso(p.date, asOf) <= 0 && p.amount > 0,
  );

  const open = (dataset.invoices ?? [])
    .filter((invoice) => !isCancelled(invoice))
    .map((invoice) => toInvoiceView(invoice, payments, asOf))
    .filter((view) => view.balance > 0);
  const overdue = open.filter((view) => view.daysOverdue > 0);

  const totalOutstanding = open.reduce((sum, view) => sum + view.balance, 0);
  const totalOverdue = overdue.reduce((sum, view) => sum + view.balance, 0);

  const intelligence = new Map<string, CustomerIntelligence>();
  for (const row of computeCustomerIntelligence(dataset)) intelligence.set(row.customerId, row);
  const names = new Map(dataset.customers.map((customer) => [customer.id, customer.name]));

  const customerOverdue = new Map<string, { amount: number; count: number }>();
  for (const view of overdue) {
    const agg = customerOverdue.get(view.customerId) ?? { amount: 0, count: 0 };
    agg.amount += view.balance;
    agg.count += 1;
    customerOverdue.set(view.customerId, agg);
  }

  const scored: ScoredItem[] = overdue.map((view) => {
    const intel = intelligence.get(view.customerId);
    const customer = customerOverdue.get(view.customerId) ?? { amount: 0, count: 0 };

    const overduePts = Math.min(40, Math.round((view.daysOverdue / 60) * 40));
    const amountPts = totalOverdue > 0 ? Math.min(30, Math.round((view.balance / totalOverdue) * 30)) : 0;
    const reliabilityPts = reliabilityPoints(intel?.reliabilityScore ?? null);
    const exposurePts = totalOverdue > 0 ? Math.min(10, Math.round((customer.amount / totalOverdue) * 10)) : 0;
    const score = Math.min(100, Math.max(0, overduePts + amountPts + reliabilityPts + exposurePts));

    const item: CollectionQueueItem = {
      invoiceId: view.id,
      invoiceNumber: view.invoiceNumber,
      customerId: view.customerId,
      customerName: names.get(view.customerId) ?? intel?.customerName ?? view.customerId,
      dueDate: view.dueDate,
      amount: view.amount,
      balance: view.balance,
      overdueAmount: view.balance,
      daysOverdue: view.daysOverdue,
      reliabilityScore: intel?.reliabilityScore ?? null,
      classification: intel?.classification ?? "insufficient_data",
      priority: priorityFor(score),
      priorityRank: 0,
      reasons: buildReasons(view, score, intel, customer.amount, customer.count),
    };
    return { item, score };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.item.daysOverdue - a.item.daysOverdue ||
      compareText(a.item.dueDate, b.item.dueDate) ||
      compareText(a.item.invoiceNumber, b.item.invoiceNumber),
  );
  const queue: CollectionQueueItem[] = scored.map((entry, index) => ({ ...entry.item, priorityRank: index + 1 }));

  const attentionCustomers = new Set(
    queue.filter((q) => q.priority === "critical" || q.priority === "high").map((q) => q.customerId),
  );
  const opportunityCount = queue.filter(
    (q) => (q.priority === "medium" || q.priority === "low") && totalOverdue > 0 && q.amount * 10 >= totalOverdue,
  ).length;

  return {
    asOfDate: asOf,
    totalOutstanding,
    totalOverdue,
    overdueInvoiceCount: queue.length,
    customersRequiringAttention: attentionCustomers.size,
    opportunityCount,
    queue,
  };
}
