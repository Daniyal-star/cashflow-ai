import { useCallback, useEffect, useState } from "react";
import { fetchCollectionsSummary } from "../api/client";
import { formatDateLabel, formatDays, formatINR, SEVERITY_BADGE } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { KpiCard } from "../components/KpiCard";
import ReminderPanel from "../components/ReminderPanel";
import ReminderHistory from "../components/ReminderHistory";
import type { CollectionQueueItem, CollectionsSummary } from "../../../shared/types";

function ReliabilityCell({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-amber-300">Insufficient data</span>;
  }
  return <span className="num text-slate-200">{score} / 100</span>;
}

function QueueRow({ item, onDraft }: { item: CollectionQueueItem; onDraft: (item: CollectionQueueItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const summary = item.reasons.slice(0, 2).join(" · ");

  return (
    <>
      <tr className="border-t border-navy-700 align-top">
        <td className="px-3 py-3">
          <span
            className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_BADGE[item.priority]}`}
          >
            {item.priority}
          </span>
        </td>
        <td className="px-3 py-3 text-slate-100">{item.customerName}</td>
        <td className="px-3 py-3 text-slate-300">{item.invoiceNumber}</td>
        <td className="whitespace-nowrap px-3 py-3 text-slate-300">{formatDateLabel(item.dueDate)}</td>
        <td className="px-3 py-3 text-right num text-slate-200">{formatINR(item.balance)}</td>
        <td className={`px-3 py-3 text-right num ${item.overdueAmount > 0 ? "text-red-400" : "text-slate-300"}`}>
          {formatINR(item.overdueAmount)}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-slate-300">{formatDays(item.daysOverdue)}</td>
        <td className="whitespace-nowrap px-3 py-3">
          <ReliabilityCell score={item.reliabilityScore} />
        </td>
        <td className="px-3 py-3 text-slate-400">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="w-full text-left hover:text-slate-200"
          >
            <span className="block">{summary}</span>
            <span className="mt-1 block text-xs text-indigo-300">{expanded ? "Hide reasons" : "All reasons"}</span>
          </button>
          {expanded && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">
            {item.reasons.map((reason, i) => (
              <li key={`reason-${item.invoiceId}-${i}`}>{reason}</li>
            ))}
          </ul>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3">
          <button
          type="button"
          onClick={() => onDraft(item)}
          className="rounded-lg border border-navy-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-navy-700"
          >
          Draft reminder
          </button>
        </td>
      </tr>
    </>
  );
}

export default function Collections() {
  const [data, setData] = useState<CollectionsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<CollectionQueueItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCollectionsSummary();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <LoadingState />;
  }

  if (error && !data) {
    return <ErrorState message={error} onRetry={load} />;
  }

  if (!data) {
    return <EmptyState title="No data" body="Collections has no data to show yet." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Smart Collections</h1>
          <p className="text-sm text-slate-400">
            Overdue invoices ranked by days overdue, amount and payment reliability
          </p>
        </div>
        {error && (
          <p className="text-sm text-amber-300">Showing last loaded data — refresh failed: {error}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total outstanding" value={formatINR(data.totalOutstanding)} tone="neutral" />
        <KpiCard
          label="Total overdue"
          value={formatINR(data.totalOverdue)}
          tone={data.totalOverdue > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          label="Overdue invoices"
          value={String(data.overdueInvoiceCount)}
          tone={data.overdueInvoiceCount > 0 ? "red" : "neutral"}
        />
        <KpiCard
          label="Customers needing attention"
          value={String(data.customersRequiringAttention)}
          hint={data.opportunityCount > 0 ? `${data.opportunityCount} quick wins` : undefined}
          tone={data.customersRequiringAttention > 0 ? "amber" : "neutral"}
        />
      </div>

      {data.queue.length === 0 ? (
        <EmptyState title="No overdue invoices" body="Every open invoice is within its due date." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-800">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-3 font-medium">Priority</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Invoice</th>
                <th className="px-3 py-3 font-medium">Due date</th>
                <th className="px-3 py-3 text-right font-medium">Outstanding</th>
                <th className="px-3 py-3 text-right font-medium">Overdue</th>
                <th className="px-3 py-3 font-medium">Days overdue</th>
                <th className="px-3 py-3 font-medium">Reliability</th>
                <th className="px-3 py-3 font-medium">Reason</th>
                <th className="px-3 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.queue.map((item) => (
                <QueueRow key={item.invoiceId} item={item} onDraft={setSelectedInvoice} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedInvoice && (
        <div className="space-y-6">
          <ReminderPanel
            key={selectedInvoice.invoiceId}
            invoice={selectedInvoice}
            onClose={() => setSelectedInvoice(null)}
            onSent={() => setRefreshKey((k) => k + 1)}
          />
          <ReminderHistory invoiceId={selectedInvoice.invoiceId} refreshKey={refreshKey} />
        </div>
      )}

      <p className="text-xs text-slate-500">
        Priority combines days overdue, overdue amount, payment reliability and customer exposure. Scores are
        calculated from recorded invoices and payments.
      </p>
    </div>
  );
}
