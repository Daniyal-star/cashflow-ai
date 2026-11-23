import { formatDateLabel, formatINR } from "../lib/format";
import type { AiCfoScenarioAdvice, InvoiceView } from "../../../shared/types";

export const DELAY_OPTIONS = [7, 15, 30];

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dateOrNone(iso: string | null): string {
  return iso ? formatDateLabel(iso) : "None";
}

export interface CfoScenarioCardProps {
  scenario: AiCfoScenarioAdvice | null;
  invoices: InvoiceView[];
  invoiceId: string;
  days: number;
  applying: boolean;
  scenarioError: string | null;
  onInvoiceChange: (id: string) => void;
  onDaysChange: (days: number) => void;
  onApply: () => void;
  onClear: () => void;
}

export function CfoScenarioCard(props: CfoScenarioCardProps) {
  const { scenario, invoices, invoiceId, days, applying, scenarioError } = props;

  return (
    <section
      className={`rounded-xl border border-navy-700 bg-navy-800 p-5 ${
        scenario ? "border-t-2 border-t-indigo-400" : ""
      }`}
    >
      <h2 className="text-sm font-semibold text-slate-100">
        {scenario ? "Scenario outlook" : "Test a scenario"}
      </h2>

      {scenario && (
        <div className="mt-2">
          <p className="text-sm text-slate-300">{scenario.summary}</p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Shortage date</dt>
              <dd className="mt-1 text-slate-200">
                {dateOrNone(scenario.shortageDateBefore)} → {dateOrNone(scenario.shortageDateAfter)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Minimum balance</dt>
              <dd className="mt-1 num text-slate-200">
                {formatINR(scenario.minimumBalanceBefore)} → {formatINR(scenario.minimumBalanceAfter)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Risk level</dt>
              <dd className="mt-1 text-slate-200">
                {capitalise(scenario.riskLevelBefore)} → {capitalise(scenario.riskLevelAfter)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate-400">{scenario.actionHint}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-400 sm:flex-none">
          Invoice
          <select
            value={invoiceId}
            onChange={(e) => props.onInvoiceChange(e.target.value)}
            className="mt-1 min-w-0 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">No scenario</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoiceNumber} — {formatINR(inv.balance)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-400">
          Delay
          <select
            value={days}
            onChange={(e) => props.onDaysChange(Number(e.target.value))}
            className="mt-1 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-100"
          >
            {DELAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={props.onApply}
          disabled={!invoiceId || applying}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
        <button
          type="button"
          onClick={props.onClear}
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-300 hover:bg-navy-700"
        >
          Clear
        </button>
      </div>
      {scenarioError && <p className="mt-3 text-sm text-red-300">{scenarioError}</p>}
    </section>
  );
}
