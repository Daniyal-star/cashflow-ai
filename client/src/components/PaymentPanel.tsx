import { useState, type FormEvent } from "react";
import { recordPayment } from "../api/client";
import { formatINR } from "../lib/format";
import { rupeesToPaise } from "../lib/money";
import { INPUT_CLASS, LABEL_CLASS, FIELD_ERROR_CLASS } from "./CustomerForm";
import type { InvoiceView } from "../../../shared/types";

/** Demo as-of date (dataset settings.asOfDate). Payments cannot be dated after it. The client has no as-of value, so this is the max. */
const DEMO_AS_OF_DATE = "2025-06-15";

interface Props {
  invoice: InvoiceView;
  onRecorded: () => void;
  onClose: () => void;
}

interface FieldErrors {
  date?: string;
  amount?: string;
}

export default function PaymentPanel({ invoice, onRecorded, onClose }: Props) {
  const [date, setDate] = useState("");
  const [amountText, setAmountText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSettled = invoice.balance <= 0 || invoice.status === "cancelled";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);

    const amountPaise = rupeesToPaise(amountText);
    const next: FieldErrors = {};
    if (!date) {
      next.date = "Payment date is required.";
    } else if (date > DEMO_AS_OF_DATE) {
      next.date = `Payment date cannot be after ${DEMO_AS_OF_DATE}.`;
    }
    if (amountPaise === null) {
      next.amount = "Enter an amount greater than 0 with at most 2 decimals (e.g. 1,500.00).";
    } else if (amountPaise > invoice.balance) {
      next.amount = `Amount cannot exceed the outstanding balance of ${formatINR(invoice.balance)}.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || amountPaise === null) return;

    setSubmitting(true);
    try {
      await recordPayment(invoice.id, { date, amount: amountPaise });
      setDate("");
      setAmountText("");
      onRecorded();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside
      aria-label="Record payment"
      className="space-y-5 rounded-xl border border-navy-700 bg-navy-800 p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Record payment</h2>
          <p className="text-sm text-slate-400">Invoice {invoice.invoiceNumber}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-navy-700 px-3 py-1 text-xs text-slate-300 hover:bg-navy-700"
        >
          Close
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Amount</dt>
          <dd className="num mt-1 text-slate-100">{formatINR(invoice.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Paid</dt>
          <dd className="num mt-1 text-teal-300">{formatINR(invoice.paidAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Balance</dt>
          <dd className="num mt-1 text-amber-300">{formatINR(invoice.balance)}</dd>
        </div>
      </dl>

      {isSettled ? (
        <p className="text-sm text-slate-400">
          {invoice.status === "cancelled"
            ? "This invoice is cancelled, so no payments can be recorded."
            : "This invoice is fully paid. No balance remains."}
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Payment form">
          {serverError && (
            <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {serverError}
            </p>
          )}

          <div>
            <label htmlFor="payment-date" className={LABEL_CLASS}>
              Payment date <span className="text-red-400">*</span>
            </label>
            {/* max is the demo as-of date, so payments cannot be dated in the future of the dataset. */}
            <input
              id="payment-date"
              type="date"
              value={date}
              max={DEMO_AS_OF_DATE}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? "payment-date-error" : undefined}
              className={INPUT_CLASS}
            />
            {errors.date && (
              <p id="payment-date-error" className={FIELD_ERROR_CLASS}>
                {errors.date}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="payment-amount" className={LABEL_CLASS}>
              Amount (₹) <span className="text-red-400">*</span>
            </label>
            <input
              id="payment-amount"
              type="text"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="e.g. 5,000.00"
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? "payment-amount-error" : undefined}
              className={`${INPUT_CLASS} num`}
            />
            {errors.amount && (
              <p id="payment-amount-error" className={FIELD_ERROR_CLASS}>
                {errors.amount}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-navy-950 hover:bg-teal-400 disabled:opacity-60"
          >
            {submitting ? "Recording…" : "Record payment"}
          </button>
        </form>
      )}
    </aside>
  );
}
