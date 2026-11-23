import { EmptyState } from "./States";
import { SEVERITY_BADGE } from "../lib/format";
import type { RiskFinding } from "../../../shared/types";

export function AlertsPanel({ risks }: { risks: RiskFinding[] }) {
  return (
    <section className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Financial alerts</h2>
      <p className="text-xs text-slate-400">Prioritised by severity from the risk engine</p>

      <div className="mt-4">
        {risks.length === 0 ? (
          <EmptyState
            title="No risk alerts"
            body="Nothing in this forecast window triggers a risk rule."
          />
        ) : (
          <ul className="space-y-3">
            {risks.map((r) => (
              <li key={r.id} className="rounded-lg border border-navy-700 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-medium uppercase ${SEVERITY_BADGE[r.severity]}`}
                  >
                    {r.severity}
                  </span>
                  <span className="font-semibold text-slate-100">{r.title}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">{r.explanation}</p>
                <p className="mt-2 text-sm font-medium text-slate-200">
                  <span className="text-slate-400">Action: </span>
                  {r.recommendedAction}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
