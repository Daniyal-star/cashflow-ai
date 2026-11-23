import { useCallback, useEffect, useState } from "react";
import { fetchReminders } from "../api/client";
import { formatDateLabel } from "../lib/format";
import { EmptyState, ErrorState } from "./States";
import type { ReminderRecord } from "../../../shared/types";

interface ReminderHistoryProps {
  invoiceId: string;
  refreshKey: number;
}

const STATUS_BADGE: Record<ReminderRecord["status"], { label: string; className: string }> = {
  sent: { label: "Sent", className: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  drafted: { label: "Drafted", className: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
};

export default function ReminderHistory({ invoiceId, refreshKey }: ReminderHistoryProps) {
  const [records, setRecords] = useState<ReminderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchReminders(invoiceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Reminder history</h2>

      {loading && records.length === 0 && (
        <div className="mt-3 space-y-2" aria-busy="true">
          <div className="h-8 animate-pulse rounded-md bg-navy-700" />
          <div className="h-8 animate-pulse rounded-md bg-navy-700" />
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      {!error && !loading && records.length === 0 && (
        <div className="mt-3">
          <EmptyState title="No reminders yet" body="No reminders recorded for this invoice yet." />
        </div>
      )}

      {!error && records.length > 0 && (
        <ul className="mt-3 divide-y divide-navy-700 text-sm">
          {records.map((record) => {
            const badge = STATUS_BADGE[record.status];
            return (
              <li key={record.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="whitespace-nowrap text-slate-300">{formatDateLabel(record.date)}</span>
                <span className="capitalize text-slate-200">{record.tone}</span>
                <span
                  className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${badge.className}`}
                >
                  {badge.label}
                </span>
                <span className="text-slate-400">
                  {record.channels.length > 0 ? record.channels.join(", ") : "No channel"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
