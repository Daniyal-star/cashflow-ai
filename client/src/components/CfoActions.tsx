import { useState } from "react";
import { formatINR } from "../lib/format";
import { EmptyState } from "./States";
import type { ActionUrgency, AiCfoAction } from "../../../shared/types";

export const URGENCY_LABEL: Record<ActionUrgency, string> = {
  now: "Act now",
  this_week: "This week",
  this_month: "This month",
};

const URGENCY_TEXT: Record<ActionUrgency, string> = {
  now: "text-red-300 border-red-500/30 bg-red-500/10",
  this_week: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  this_month: "text-slate-300 border-navy-700 bg-navy-900",
};

function ActionItem({ action }: { action: AiCfoAction }) {
  const [open, setOpen] = useState(false);
  const detailId = `cfo-action-detail-${action.id}`;

  return (
    <li className="flex gap-3 rounded-xl border border-navy-700 bg-navy-800 p-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-300 num">
        {action.rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-semibold text-slate-100">{action.title}</span>
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${URGENCY_TEXT[action.urgency]}`}
          >
            {URGENCY_LABEL[action.urgency]}
          </span>
        </div>
        {action.expectedImpact > 0 && (
          <p className="mt-1 text-xs text-slate-400">
            Cash at stake: <span className="num text-slate-200">{formatINR(action.expectedImpact)}</span>
          </p>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-xs font-medium text-indigo-300 hover:text-indigo-200"
        >
          {open ? "Hide details" : "Details"}
        </button>
        {open && (
          <div id={detailId} className="mt-2 space-y-1 text-sm text-slate-300">
            <p>{action.detail}</p>
            {action.coverageShare !== null && (
              <p className="text-xs text-slate-400">
                Covers {Math.round(action.coverageShare * 100)}% of the shortage
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function CfoActions({ actions }: { actions: AiCfoAction[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-100">Prioritised actions</h2>
      {actions.length === 0 ? (
        <EmptyState title="No actions needed" body="No overdue receivables or shortage in the forecast window." />
      ) : (
        <ol className="space-y-3">
          {actions.map((a) => (
            <ActionItem key={a.id} action={a} />
          ))}
        </ol>
      )}
    </section>
  );
}
