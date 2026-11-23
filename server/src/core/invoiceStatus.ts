/**
 * Invoice status and balance derivation for CASHFLOW AI. Pure functions, no I/O.
 *
 * Money is integer paise. Dates are "YYYY-MM-DD" and compared as strings (ISO order).
 *
 * Status mapping (deriveInvoiceStatus), evaluated in this exact order:
 *   1. cancelled === true or status === "cancelled"  -> "cancelled"
 *   2. balance = amount - paid <= 0                  -> "paid"
 *   3. dueDate < asOfDate                            -> "overdue"
 *   4. paid > 0                                      -> "partially_paid"
 *   5. otherwise                                     -> "sent"  (this is the "unpaid" state;
 *      no separate enum value is added)
 */

import type { Invoice, InvoiceStatus, InvoiceView, Payment } from "../../../shared/types.js";
import { diffDays, isValidIsoDate } from "./dates.js";

/** Sum of all payment amounts recorded against an invoice, regardless of payment date. */
export function paidAmountFor(invoiceId: string, payments: Payment[]): number {
  let total = 0;
  for (const payment of payments) {
    if (payment.invoiceId === invoiceId) total += payment.amount;
  }
  return total;
}

export function deriveInvoiceStatus(invoice: Invoice, paidAmount: number, asOfDate: string): InvoiceStatus {
  if (invoice.cancelled === true || invoice.status === "cancelled") return "cancelled";

  const balance = invoice.amount - paidAmount;
  if (balance <= 0) return "paid";

  if (invoice.dueDate < asOfDate) return "overdue";

  if (paidAmount > 0) return "partially_paid";

  return "sent";
}

/** Whole days past due as of asOfDate; 0 when paid, cancelled, not yet due, or dates are invalid. */
export function daysOverdueFor(invoice: Invoice, paidAmount: number, asOfDate: string): number {
  if (invoice.cancelled === true || invoice.status === "cancelled") return 0;
  if (invoice.amount - paidAmount <= 0) return 0;
  if (!isValidIsoDate(invoice.dueDate) || !isValidIsoDate(asOfDate)) return 0;
  if (invoice.dueDate >= asOfDate) return 0;
  return diffDays(invoice.dueDate, asOfDate);
}

export function toInvoiceView(invoice: Invoice, payments: Payment[], asOfDate: string): InvoiceView {
  const paidAmount = paidAmountFor(invoice.id, payments);
  const balance = Math.max(0, invoice.amount - paidAmount);
  const daysOverdue = daysOverdueFor(invoice, paidAmount, asOfDate);
  return {
    ...invoice,
    status: deriveInvoiceStatus(invoice, paidAmount, asOfDate),
    paidAmount,
    balance,
    daysOverdue,
  };
}
