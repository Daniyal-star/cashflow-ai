import { useState } from "react";
import { SEVERITY_BADGE } from "../lib/format";
import { URGENCY_LABEL } from "./CfoActions";
import type { AiCfoRiskItem } from "../../../shared/types";

function RiskCard({ risk }: { risk: AiCfoRiskItem }) {
  const [open, setOpen] = useState(false);
  const detailId = `cfo-risk-detail-${risk.riskId}`;
  const sameText = risk.explanation.trim() === risk.consequence.trim();

  return (
    <li className="rounded-xl border border-navy-700 bg-navy-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_BADGE[risk.severity]}`}
        >
          {risk.severity}
        </span>
        <span className="min-w-0 font-semibold text-slate-100">{risk.title}</span>
        <span className="ml-auto text-xs text-slate-400">{URGENCY_LABEL[risk.urgency]}</span>
      </div>
      <p className="mt-2 truncate text-sm text-slate-300" title={risk.explanation}>
        {risk.explanation}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs font-medium text-indigo-300 hover:text-indigo-200"
      >
        {open ? "Hide details" : "Show details"}
      </button>
      {open && (
        <div id={detailId} className="mt-2 space-y-2 text-sm">
          {sameText ? (
            <p className="text-slate-300">{risk.explanation}</p>
          ) : (
            <>
              <p className="text-slate-300">{risk.explanation}</p>
              <p className="text-slate-400">
                <span className="font-semibold text-slate-300">Consequence:</span> {risk.consequence}
              </p>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function CfoRiskList({ risks }: { risks: AiCfoRiskItem[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-100">Key risks</h2>
      {risks.length === 0 ? (
        <p className="rounded-xl border border-navy-700 bg-navy-800 p-4 text-sm text-slate-400">
          No active risks detected.
        </p>
      ) : (
        <ul className="space-y-3">
          {risks.map((r) => (
            <RiskCard key={r.riskId} risk={r} />
          ))}
        </ul>
      )}
    </section>
  );
}
