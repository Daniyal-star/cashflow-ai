import { useState, type FormEvent } from "react";
import { createInvoice, updateInvoice } from "../api/client";
import { paiseToRupeInput, rupeesToPaise } from "../lib/money";
import { INPUT_CLASS, LABEL_CLASS, FIELD_ERROR_CLASS } from "./CustomerForm";
import type { CustomerView, InvoiceInput, InvoiceView } from "../../../shared/types";

interface Props {
  /** When provided the form edits this invoice; otherwise it creates one. */
  invoice?: InvoiceView | null;
  customers: CustomerView[];
  onSaved: () => void;
  onCancel: () => void;
}

interface FieldErrors {
  invoiceNumber?: string;
  customerId?: string;
  issueDate?: string;
  dueDate?: string;
  amount?: string;
}

export default function InvoiceForm({ invoice, customers, onSaved, onCancel }: Props) {
  const isEdit = Boolean(invoice);
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? "");
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? "");
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? "");
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [amountText, setAmountText] = useState(invoice ? paiseToRupeInput(invoice.amount) : "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [cancelled, setCancelled] = useState(
    invoice ? invoice.cancelled === true || invoice.status === "cancelled" : false,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(amountPaise: number | null): FieldErrors {
    const next: FieldErrors = {};
    if (!invoiceNumber.trim()) next.invoiceNumber = "Invoice number is required.";
    if (!customerId) next.customerId = "Select a customer.";
    if (!issueDate) next.issueDate = "Issue date is required.";
    if (!dueDate) next.dueDate = "Due date is required.";
    if (issueDate && dueDate && dueDate < issueDate) {
      next.dueDate = "Due date cannot be before the issue date.";
    }
    if (amountPaise === null) {
      next.amount = "Enter an amount greater than 0 with at most 2 decimals (e.g. 1,500.00).";
    }
    return next;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amountPaise = rupeesToPaise(amountText);
    const nextErrors = validate(amountPaise);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0 || amountPaise === null) return;

    setSubmitting(true);
    try {
      if (isEdit && invoice) {
        // On edit, an empty notes field is sent as "" so it can be cleared.
        const input: Partial<InvoiceInput> = {
          invoiceNumber: invoiceNumber.trim(),
          customerId,
          issueDate,
          dueDate,
          amount: amountPaise,
          notes: notes.trim(),
          cancelled,
        };
        await updateInvoice(invoice.id, input);
      } else {
        const input: InvoiceInput = {
          invoiceNumber: invoiceNumber.trim(),
          customerId,
          issueDate,
          dueDate,
          amount: amountPaise,
        };
        if (notes.trim()) input.notes = notes.trim();
        await createInvoice(input);
      }
      onSaved();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={isEdit ? "Edit invoice" : "New invoice"}>
      <h2 className="text-lg font-semibold text-slate-100">{isEdit ? "Edit invoice" : "New invoice"}</h2>

      {serverError && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {serverError}
        </p>
      )}

      <div>
        <label htmlFor="invoice-number" className={LABEL_CLASS}>
          Invoice number <span className="text-red-400">*</span>
        </label>
        <input
          id="invoice-number"
          type="text"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          aria-invalid={Boolean(errors.invoiceNumber)}
          aria-describedby={errors.invoiceNumber ? "invoice-number-error" : undefined}
          className={INPUT_CLASS}
        />
        {errors.invoiceNumber && (
          <p id="invoice-number-error" className={FIELD_ERROR_CLASS}>
            {errors.invoiceNumber}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="invoice-customer" className={LABEL_CLASS}>
          Customer <span className="text-red-400">*</span>
        </label>
        <select
          id="invoice-customer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          aria-invalid={Boolean(errors.customerId)}
          aria-describedby={errors.customerId ? "invoice-customer-error" : undefined}
          className={INPUT_CLASS}
        >
          <option value="">Select a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors.customerId && (
          <p id="invoice-customer-error" className={FIELD_ERROR_CLASS}>
            {errors.customerId}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invoice-issue-date" className={LABEL_CLASS}>
            Issue date <span className="text-red-400">*</span>
          </label>
          <input
            id="invoice-issue-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            aria-invalid={Boolean(errors.issueDate)}
            aria-describedby={errors.issueDate ? "invoice-issue-date-error" : undefined}
            className={INPUT_CLASS}
          />
          {errors.issueDate && (
            <p id="invoice-issue-date-error" className={FIELD_ERROR_CLASS}>
              {errors.issueDate}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="invoice-due-date" className={LABEL_CLASS}>
            Due date <span className="text-red-400">*</span>
          </label>
          <input
            id="invoice-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={Boolean(errors.dueDate)}
            aria-describedby={errors.dueDate ? "invoice-due-date-error" : undefined}
            className={INPUT_CLASS}
          />
          {errors.dueDate && (
            <p id="invoice-due-date-error" className={FIELD_ERROR_CLASS}>
              {errors.dueDate}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="invoice-amount" className={LABEL_CLASS}>
          Amount (₹) <span className="text-red-400">*</span>
        </label>
        <input
          id="invoice-amount"
          type="text"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="e.g. 12,500.00"
          aria-invalid={Boolean(errors.amount)}
          aria-describedby={errors.amount ? "invoice-amount-error" : undefined}
          className={`${INPUT_CLASS} num`}
        />
        {errors.amount && (
          <p id="invoice-amount-error" className={FIELD_ERROR_CLASS}>
            {errors.amount}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="invoice-notes" className={LABEL_CLASS}>
          Notes
        </label>
        <textarea
          id="invoice-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      {isEdit && (
        <div className="flex items-center gap-2">
          <input
            id="invoice-cancelled"
            type="checkbox"
            checked={cancelled}
            onChange={(e) => setCancelled(e.target.checked)}
            className="h-4 w-4 rounded border-navy-700 bg-navy-900 accent-teal-500"
          />
          <label htmlFor="invoice-cancelled" className="text-sm text-slate-300">
            Cancelled
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-300 hover:bg-navy-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-navy-950 hover:bg-teal-400 disabled:opacity-60"
        >
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create invoice"}
        </button>
      </div>
    </form>
  );
}
