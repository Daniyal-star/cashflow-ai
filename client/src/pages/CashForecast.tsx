import { useCallback, useEffect, useState } from "react";
import { fetchForecast } from "../api/client";
import { formatDateLabel, formatDays, formatINR, riskTone, type Tone } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { KpiCard } from "../components/KpiCard";
import { ClosingCashChart, FlowChart } from "../components/ForecastCharts";
import type { ForecastResult } from "../../../shared/types";

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rowToneClass(balance: number, safetyBuffer: number): string {
  if (balance < 0) return "bg-red-500/10 text-red-300";
  if (balance < safetyBuffer) return "bg-amber-500/10 text-amber-300";
  return "";
}

export default function CashForecast() {
  const [data, setData] = useState<ForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchForecast();
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
    return <EmptyState title="No forecast" body="The forecast has no data to show yet." />;
  }

  if (data.days.length === 0) {
    return <EmptyState title="No forecast days" body="There are no forecast days to show yet." />;
  }

  const totalIn = data.days.reduce((sum, d) => sum + d.incoming, 0);
  const totalOut = data.days.reduce((sum, d) => sum + d.outgoing, 0);

  const minTone: Tone =
    data.minimumBalance < 0 ? "red" : data.minimumBalance < data.safetyBuffer ? "amber" : "teal";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Cash Forecast</h1>
          <p className="text-sm text-slate-400">
            Starting from {formatDateLabel(data.asOfDate)} · {data.horizonDays} days
          </p>
        </div>
        {error && (
          <p className="text-sm text-amber-300">Showing last loaded data — refresh failed: {error}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Opening balance" value={formatINR(data.openingBalance)} tone="neutral" />
        <KpiCard label="Expected inflows" value={formatINR(totalIn)} tone="teal" />
        <KpiCard label="Expected outflows" value={formatINR(totalOut)} tone="neutral" />
        <KpiCard
          label="Minimum projected balance"
          value={formatINR(data.minimumBalance)}
          hint={`on ${formatDateLabel(data.minimumBalanceDate)}`}
          tone={minTone}
        />
        <KpiCard
          label="Shortage"
          value={data.shortageDate ? `from ${formatDateLabel(data.shortageDate)}` : "None in horizon"}
          hint={data.shortageDate ? formatINR(data.shortageAmount) : undefined}
          tone={data.shortageDate ? "red" : "teal"}
        />
        <KpiCard
          label="Cash runway"
          value={formatDays(data.cashRunwayDays)}
          tone={data.shortageDate ? "red" : "teal"}
        />
        <KpiCard label="Risk level" value={capitalise(data.riskLevel)} tone={riskTone(data.riskLevel)} />
      </div>

      <ClosingCashChart days={data.days} safetyBuffer={data.safetyBuffer} />
      <FlowChart days={data.days} />

      <details className="rounded-xl border border-navy-700 bg-navy-800 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Daily table</summary>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 text-right font-medium">Incoming</th>
                <th className="py-2 pr-4 text-right font-medium">Outgoing</th>
                <th className="py-2 text-right font-medium">Closing balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700 text-slate-300">
              {data.days.map((d) => (
                <tr key={d.date} className={rowToneClass(d.balance, data.safetyBuffer)}>
                  <td className="py-2 pr-4">{formatDateLabel(d.date)}</td>
                  <td className="py-2 pr-4 text-right num">{formatINR(d.incoming)}</td>
                  <td className="py-2 pr-4 text-right num">{formatINR(d.outgoing)}</td>
                  <td className="py-2 text-right num">{formatINR(d.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-xl border border-navy-700 bg-navy-800 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Forecast assumptions</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-400">
          {data.assumptions.map((a, i) => (
            <li key={`assumption-${i}`}>{a}</li>
          ))}
        </ul>
        {data.warnings.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-semibold text-amber-300">Warnings</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
              {data.warnings.map((w, i) => (
                <li key={`warning-${i}`}>{w}</li>
              ))}
            </ul>
          </>
        )}
      </details>
    </div>
  );
}
