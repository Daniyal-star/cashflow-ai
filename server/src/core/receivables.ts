/**
 * Open receivables for CASHFLOW AI.
 *
 * An open receivable is a non-cancelled invoice whose amount, less payments dated on or before the as-of date,
 * is still above zero. Money is integer paise. Invoices with an invalid dueDate are skipped, as in the
 * forecast and risk engines.
 */

import type { Dataset, Invoice, Payment } from "../../../shared/types.js";
import { compareIso, diffDays, isValidIsoDate } from "./dates.js";

export interface OpenReceivable {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  dueDate: string;
  /** Paise still unpaid as of asOfDate (always > 0). */
  remaining: number;
  /** Whole days past dueDate as of asOfDate; 0 when not yet due. */
  daysOverdue: number;
}

export function openReceivables(dataset: Dataset, asOfDate: string): OpenReceivable[] {
  const paidByInvoice = new Map<string, number>();
  for (const payment of (dataset.payments ?? []) as Payment[]) {
    if (!isValidIsoDate(payment.date) || !(payment.amount > 0)) continue;
    if (compareIso(payment.date, asOfDate) > 0) continue;
    paidByInvoice.set(payment.invoiceId, (paidByInvoice.get(payment.invoiceId) ?? 0) + payment.amount);
  }

  const result: OpenReceivable[] = [];
  for (const invoice of (dataset.invoices ?? []) as Invoice[]) {
    if (invoice.status === "cancelled" || invoice.cancelled === true) continue;
    if (!isValidIsoDate(invoice.dueDate)) continue;

    const remaining = Math.max(0, invoice.amount - (paidByInvoice.get(invoice.id) ?? 0));
    if (remaining <= 0) continue;

    result.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      dueDate: invoice.dueDate,
      remaining,
      daysOverdue: Math.max(0, diffDays(invoice.dueDate, asOfDate)),
    });
  }
  return result;
}
