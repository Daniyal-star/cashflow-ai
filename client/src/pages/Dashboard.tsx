import { useCallback, useEffect, useState } from "react";
import { fetchDashboard } from "../api/client";
import { formatDateLabel, formatDays, formatINR, riskTone, type Tone } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { KpiCard } from "../components/KpiCard";
import { CashCharts } from "../components/CashCharts";
import { AlertsPanel } from "../components/AlertsPanel";
import { CollectionPriorities } from "../components/CollectionPriorities";
import type { DashboardResponse } from "../../../shared/types";

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboard();
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
    return <EmptyState title="No data" body="The dashboard has no data to show yet." />;
  }

  const k = data.kpis;

  const minTone: Tone =
    k.projectedMinimumBalance < 0 ? "red" : k.projectedMinimumBalance < k.safetyBuffer ? "amber" : "teal";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-400">As of {formatDateLabel(data.asOfDate)}</p>
        </div>
        {error && (
          <p className="text-sm text-amber-300">
            Showing last loaded data — refresh failed: {error}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Available cash" value={formatINR(k.availableCash)} tone="neutral" />
        <KpiCard
          label="Outstanding receivables"
          value={formatINR(k.outstandingReceivables)}
          hint={`${formatINR(k.overdueReceivables)} overdue`}
          tone={k.overdueReceivables > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          label="Upcoming expenses"
          value={formatINR(k.upcomingExpenses)}
          hint={`Expected inflows ${formatINR(k.expectedInflows)}`}
          tone="neutral"
        />
        <KpiCard
          label="Projected minimum balance"
          value={formatINR(k.projectedMinimumBalance)}
          hint={`on ${formatDateLabel(k.minimumBalanceDate)}`}
          tone={minTone}
        />
        <KpiCard
          label="Cash runway"
          value={formatDays(k.cashRunwayDays)}
          hint={k.shortageDate ? `Shortage from ${formatDateLabel(k.shortageDate)}` : "No shortage in horizon"}
          tone={k.shortageDate ? "red" : "teal"}
        />
        <KpiCard
          label="Risk level"
          value={capitalise(k.riskLevel)}
          tone={riskTone(k.riskLevel)}
        />
      </div>

      <CashCharts days={data.forecast.days} safetyBuffer={k.safetyBuffer} />

      <div className="grid gap-6 xl:grid-cols-2">
        <AlertsPanel risks={data.risks} />
        <CollectionPriorities items={data.collectionPriorities} />
      </div>

      <details className="rounded-xl border border-navy-700 bg-navy-800 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Forecast assumptions</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-400">
          {data.forecast.assumptions.map((a, i) => (
            <li key={`assumption-${i}`}>{a}</li>
          ))}
        </ul>
        {data.forecast.warnings.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-semibold text-amber-300">Warnings</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
              {data.forecast.warnings.map((w, i) => (
                <li key={`warning-${i}`}>{w}</li>
              ))}
            </ul>
          </>
        )}
      </details>
    </div>
  );
}
