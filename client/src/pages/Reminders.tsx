
import { useCallback, useEffect, useState } from "react";
import {
  fetchCollectionsSummary,
  fetchReminders,
} from "../api/client";
import { formatDateLabel, formatDays, formatINR, SEVERITY_BADGE } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { KpiCard } from "../components/KpiCard";
import ReminderPanel from "../components/ReminderPanel";
import ReminderHistory from "../components/ReminderHistory";
import type {
  CollectionQueueItem,
  CollectionsSummary,
  ReminderRecord,
} from "../../../shared/types";

export default function Reminders() {
  const [data, setData] = useState<CollectionsSummary | null>(null);
  const [records, setRecords] = useState<ReminderRecord[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<CollectionQueueItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [summary, reminders] = await Promise.all([
        fetchCollectionsSummary(),
        fetchReminders(),
      ]);

      setData(summary);
      setRecords(reminders);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <EmptyState title="No data" body="No reminder data available." />;

  const sentCount = records.filter((r) => r.status === "sent").length;
  const draftedCount = records.filter((r) => r.status === "drafted").length;

  const filteredQueue = data.queue.filter((item) => {
    const matchesSearch =
      item.customerName.toLowerCase().includes(search.toLowerCase()) ||
      item.invoiceNumber.toLowerCase().includes(search.toLowerCase());

    const matchesFilter = filter === "all" || item.priority === filter;

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Payment Reminders</h1>
          <p className="text-sm text-slate-400">
            Manage customer follow-ups and track recorded payment reminders.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-200 hover:bg-navy-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-sm text-amber-300">
          Refresh failed. Showing previously loaded data: {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Invoices needing follow-up"
          value={String(data.queue.length)}
          tone={data.queue.length > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          label="Total overdue"
          value={formatINR(data.totalOverdue)}
          tone={data.totalOverdue > 0 ? "red" : "neutral"}
        />
        <KpiCard
          label="Reminders recorded as sent"
          value={String(sentCount)}
          tone="neutral"
        />
        <KpiCard
          label="Drafts recorded"
          value={String(draftedCount)}
          tone="neutral"
        />
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Follow-up queue</h2>
          <p className="text-sm text-slate-400">
            Invoices are ranked using the existing Smart Collections priority calculation.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer or invoice..."
            className="min-w-[220px] flex-1 rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-slate-100"
          />

          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-slate-100"
          >
            <option value="all">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        {filteredQueue.length === 0 ? (
          <EmptyState
            title="No invoices found"
            body="No invoices match your search or priority filter."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-800">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Invoice</th>
                  <th className="px-3 py-3">Due date</th>
                  <th className="px-3 py-3 text-right">Outstanding</th>
                  <th className="px-3 py-3">Days overdue</th>
                  <th className="px-3 py-3">Action</th>
                </tr>
              </thead>

              <tbody>
                {filteredQueue.map((item) => (
                  <tr key={item.invoiceId} className="border-t border-navy-700">
                    <td className="px-3 py-3">
                      <span className={`rounded-md border px-2 py-1 text-xs uppercase ${SEVERITY_BADGE[item.priority]}`}>
                        {item.priority}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-100">{item.customerName}</td>
                    <td className="px-3 py-3 text-slate-300">{item.invoiceNumber}</td>
                    <td className="px-3 py-3 text-slate-300">{formatDateLabel(item.dueDate)}</td>
                    <td className="px-3 py-3 text-right text-slate-200">
                      {formatINR(item.balance)}
                    </td>
                    <td className="px-3 py-3 text-slate-300">
                      {formatDays(item.daysOverdue)}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(item)}
                        className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400"
                      >
                        Draft reminder
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedInvoice && (
        <div className="space-y-5">
          <ReminderPanel
            key={selectedInvoice.invoiceId}
            invoice={selectedInvoice}
            onClose={() => setSelectedInvoice(null)}
            onSent={() => {
              setRefreshKey((key) => key + 1);
              setSelectedInvoice(null);
            }}
          />

          <ReminderHistory
            invoiceId={selectedInvoice.invoiceId}
            refreshKey={refreshKey}
          />
        </div>
      )}

      <section className="rounded-xl border border-navy-700 bg-navy-800 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Reminder history overview</h2>
        <p className="mt-1 text-sm text-slate-400">
          {records.length} reminder records are stored in your application.
          Select an invoice above to view its individual history.
        </p>
      </section>

      <p className="text-xs text-slate-500">
        Marking a reminder as sent records it in CASHFLOW AI. It does not automatically send a WhatsApp message or email.
      </p>
    </div>
  );
}
