import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCustomerIntelligence, fetchCustomerIntelligenceDetail } from "../api/client";
import { formatDays, formatINR, SEVERITY_BADGE } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import type { CustomerClassification, CustomerIntelligence } from "../../../shared/types";

const CLASSIFICATION_LABEL: Record<CustomerClassification, string> = {
  reliable: "Reliable",
  occasionally_late: "Occasionally late",
  consistently_late: "Consistently late",
  insufficient_data: "Insufficient data",
};

/** "+6.0 days" for late, "−2.0 days" for early, "0 days" for on time. */
function formatDelay(days: number | null): string {
  if (days === null) return "Insufficient data";
  if (days === 0) return "0 days";
  const magnitude = Math.abs(days).toFixed(1);
  return days > 0 ? `+${magnitude} days` : `\u2212${magnitude} days`;
}

export default function CustomerIntelligencePage() {
  const [rows, setRows] = useState<CustomerIntelligence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fallbackDetail, setFallbackDetail] = useState<CustomerIntelligence | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCustomerIntelligence();
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The detail panel reads from the loaded list. The detail endpoint is only used if the selected row is missing.
  const selectedRow = useMemo(
    () => (rows && selectedId ? rows.find((r) => r.customerId === selectedId) ?? null : null),
    [rows, selectedId],
  );

  useEffect(() => {
    if (!selectedId || selectedRow) {
      setFallbackDetail(null);
      return;
    }
    let cancelled = false;
    fetchCustomerIntelligenceDetail(selectedId)
      .then((row) => {
        if (!cancelled) setFallbackDetail(row);
      })
      .catch(() => {
        if (!cancelled) setFallbackDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedRow]);

  const detail = selectedRow ?? fallbackDetail;

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter((r) => r.customerName.toLowerCase().includes(q));
  }, [rows, search]);

  if (loading && !rows) {
    return <LoadingState />;
  }

  if (error && !rows) {
    return <ErrorState message={error} onRetry={load} />;
  }

  if (!rows) {
    return <EmptyState title="No data" body="Customer intelligence has no data to show yet." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Customer Intelligence</h1>
          <p className="text-sm text-slate-400">Based on recorded invoice and payment dates only</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {error && <p className="text-sm text-amber-300">Showing last loaded data — refresh failed: {error}</p>}
          <Link to="/customers/manage" className="text-sm text-teal-300 underline-offset-2 hover:underline">
            Manage customer records
          </Link>
        </div>
      </div>

      <div>
        <label htmlFor="customer-intelligence-search" className="block text-sm text-slate-400">
          Search customers
        </label>
        <input
          id="customer-intelligence-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-md border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-slate-100"
        />
      </div>

      {filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState title="No customers" body="No customers have been recorded yet." />
        ) : (
          <EmptyState title="No customers match this search" body="Try a different name." />
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-800">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Reliability</th>
                <th className="px-4 py-3 font-medium">Classification</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Avg delay</th>
                <th className="px-4 py-3 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {filtered.map((r) => {
                const isSelected = r.customerId === selectedId;
                return (
                  <tr
                    key={r.customerId}
                    onClick={() => setSelectedId(r.customerId)}
                    className={`cursor-pointer hover:bg-navy-700/50 ${isSelected ? "bg-navy-700/50" : ""}`}
                  >
                    <td className="px-4 py-3 text-slate-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.customerId);
                        }}
                        aria-pressed={isSelected}
                        className="text-left font-medium text-slate-100 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                      >
                        {r.customerName}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {r.reliabilityScore === null ? (
                        <span className="text-amber-300">Insufficient data</span>
                      ) : (
                        <span className="text-slate-100">{r.reliabilityScore} / 100</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{CLASSIFICATION_LABEL[r.classification]}</td>
                    <td className="px-4 py-3 text-slate-100">{formatINR(r.outstanding)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatDelay(r.averagePaymentDelayDays)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs font-medium uppercase ${SEVERITY_BADGE[r.riskLevel]}`}
                      >
                        {r.riskLevel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <section
          aria-label="Customer detail"
          className="rounded-xl border border-navy-700 bg-navy-800 p-5 space-y-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-100">{detail.customerName}</h2>
            <span className="text-sm text-slate-400">{CLASSIFICATION_LABEL[detail.classification]}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-slate-400">Reliability</p>
              <p className={detail.reliabilityScore === null ? "text-amber-300" : "text-slate-100"}>
                {detail.reliabilityScore === null ? "Insufficient data" : `${detail.reliabilityScore} / 100`}
              </p>
              <p className="mt-1 text-sm text-slate-400">{detail.reliabilityExplanation}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Settled invoices</p>
              <p className="text-slate-100">{detail.settledInvoiceCount}</p>
              <p className="text-xs uppercase text-slate-400 mt-2">On-time payments</p>
              <p className="text-slate-100">
                {detail.onTimeRatio === null ? "Insufficient data" : `${Math.round(detail.onTimeRatio * 100)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Average payment delay</p>
              <p className="text-slate-100">{formatDelay(detail.averagePaymentDelayDays)}</p>
              <p className="text-xs uppercase text-slate-400 mt-2">Outstanding</p>
              <p className="text-slate-100">{formatINR(detail.outstanding)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Overdue amount</p>
              <p className="text-slate-100">{formatINR(detail.overdueAmount)}</p>
              {detail.maxDaysOverdue > 0 && (
                <p className="text-sm text-amber-300">Max {formatDays(detail.maxDaysOverdue)} overdue</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-slate-400">Concentration share</p>
              <p className="text-slate-100">{Math.round(detail.concentrationShare * 100)}%</p>
              {detail.concentrationFlag && (
                <p className="text-sm text-amber-300">Above concentration threshold</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase text-slate-400">Risk level</p>
              <span
                className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium uppercase ${SEVERITY_BADGE[detail.riskLevel]}`}
              >
                {detail.riskLevel}
              </span>
              <p className="mt-2 text-xs uppercase text-slate-400">Risk reasons</p>
              {detail.riskReasons.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-400">
                  {detail.riskReasons.map((reason, i) => (
                    <li key={`reason-${i}`}>{reason}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-slate-400">No risk triggers</p>
              )}
            </div>
          </div>
        </section>
      )}

      <p className="text-xs text-slate-500">
        Scores need at least 3 fully paid invoices. Partially paid invoices are not counted as settled.
      </p>
    </div>
  );
}
