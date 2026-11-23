import { useState, type FormEvent } from "react";
import { formatINR } from "../lib/format";
import type { CustomerView, InvoiceView, ScenarioAdjustment } from "../../../shared/types";

export const MAX_DELAY_DAYS = 365;
const QUICK_PICKS = [7, 15, 30];

type TargetType = "customer" | "invoice";

/** Returns the delay as an integer 0–365, or null if the text is not valid. */
export function parseDelayDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 0 && n <= MAX_DELAY_DAYS ? n : null;
}

interface ScenarioFormProps {
  customers: CustomerView[];
  invoices: InvoiceView[];
  running: boolean;
  onRun: (adjustment: ScenarioAdjustment, days: number) => void;
  onReset: () => void;
}

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-100 focus:border-teal-400 focus:outline-none";

export function ScenarioForm({ customers, invoices, running, onRun, onReset }: ScenarioFormProps) {
  const [targetType, setTargetType] = useState<TargetType>("customer");
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [daysText, setDaysText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const customerOptions = customers.filter((c) => c.outstanding > 0);
  const invoiceOptions = invoices.filter((i) => i.balance > 0 && i.status !== "cancelled" && !i.cancelled);
  const daysInvalid = parseDelayDays(daysText) === null;
  const showDaysError = (attempted || daysText.trim() !== "") && daysInvalid;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAttempted(true);
    setFormError(null);

    const days = parseDelayDays(daysText);
    if (days === null) return;

    if (targetType === "customer") {
      if (!customerId) {
        setFormError("Select a customer.");
        return;
      }
      onRun({ type: "customer_delay", customerId, days }, days);
    } else {
      if (!invoiceId) {
        setFormError("Select an invoice.");
        return;
      }
      onRun({ type: "invoice_delay", invoiceId, days }, days);
    }
  }

  function handleReset() {
    setTargetType("customer");
    setCustomerId("");
    setInvoiceId("");
    setDaysText("");
    setAttempted(false);
    setFormError(null);
    onReset();
  }

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Build a scenario</h2>

      <form onSubmit={handleSubmit} className="mt-4 space-y-5" noValidate>
        <fieldset>
          <legend className="text-xs uppercase tracking-wide text-slate-400">Target</legend>
          <div className="mt-2 flex gap-4 text-sm text-slate-200">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scenario-target"
                value="customer"
                checked={targetType === "customer"}
                onChange={() => setTargetType("customer")}
                className="accent-teal-400"
              />
              Customer
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scenario-target"
                value="invoice"
                checked={targetType === "invoice"}
                onChange={() => setTargetType("invoice")}
                className="accent-teal-400"
              />
              Invoice
            </label>
          </div>
        </fieldset>

        {targetType === "customer" ? (
          <div>
            <label htmlFor="scenario-customer" className="text-xs uppercase tracking-wide text-slate-400">
              Customer with outstanding balance
            </label>
            <select
              id="scenario-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Select a customer</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {customerOptions.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">No customers have an outstanding balance.</p>
            )}
          </div>
        ) : (
          <div>
            <label htmlFor="scenario-invoice" className="text-xs uppercase tracking-wide text-slate-400">
              Invoice with open balance
            </label>
            <select
              id="scenario-invoice"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Select an invoice</option>
              {invoiceOptions.map((i) => (
                <option key={i.id} value={i.id}>
                  {`${i.invoiceNumber} · ${formatINR(i.balance)}`}
                </option>
              ))}
            </select>
            {invoiceOptions.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">No invoices have an open balance.</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="scenario-days" className="text-xs uppercase tracking-wide text-slate-400">
            Delay (days)
          </label>
          <input
            id="scenario-days"
            type="text"
            inputMode="numeric"
            value={daysText}
            onChange={(e) => setDaysText(e.target.value)}
            placeholder="0–365"
            aria-invalid={showDaysError}
            aria-describedby={showDaysError ? "scenario-days-error" : undefined}
            className={INPUT_CLASS}
          />
          {showDaysError && (
            <p id="scenario-days-error" className="mt-1 text-xs text-red-300">
              Enter a whole number of days from 0 to {MAX_DELAY_DAYS}.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {QUICK_PICKS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDaysText(String(n))}
                className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-1 text-xs text-slate-300 hover:border-teal-400 hover:text-white"
              >
                {n} days
              </button>
            ))}
          </div>
        </div>

        {formError && <p className="text-sm text-red-300">{formError}</p>}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={running}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400 disabled:opacity-50"
          >
            {running ? "Running…" : "Run scenario"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-300 hover:text-white"
          >
            Reset scenario
          </button>
        </div>
      </form>

      <p className="mt-6 text-xs text-slate-500">
        The scenario runs through the same forecast engine as the baseline and does not change any recorded data.
      </p>
    </div>
  );
}
