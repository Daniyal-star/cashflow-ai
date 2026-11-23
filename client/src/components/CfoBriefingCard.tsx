import { formatDateLabel, formatINR } from "../lib/format";
import type { AiCfoBriefing, RiskLevel } from "../../../shared/types";

type Urgency = "red" | "amber" | "teal";

const BAR_CLASS: Record<Urgency, string> = {
  red: "bg-red-500",
  amber: "bg-amber-400",
  teal: "bg-teal-400",
};

const RISK_TEXT: Record<RiskLevel, string> = {
  low: "text-teal-300",
  medium: "text-amber-300",
  high: "text-orange-300",
  critical: "text-red-400",
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function urgencyOf(briefing: AiCfoBriefing): Urgency {
  const { shortageDate, riskLevel } = briefing.metrics;
  if (shortageDate || riskLevel === "critical") return "red";
  if (riskLevel === "high" || riskLevel === "medium") return "amber";
  return "teal";
}

/** One line of urgency at most: the shortage date, else overdue money, else nothing. */
function urgencyLine(briefing: AiCfoBriefing): string | null {
  const m = briefing.metrics;
  if (m.shortageDate) {
    return `Shortage projected from ${formatDateLabel(m.shortageDate)} (${formatINR(m.shortageAmount)} short).`;
  }
  if (m.overdueReceivables > 0) {
    return `${formatINR(m.overdueReceivables)} is overdue from customers.`;
  }
  return null;
}

export function CfoBriefingCard({ briefing }: { briefing: AiCfoBriefing }) {
  const urgency = urgencyOf(briefing);
  const line = urgencyLine(briefing);
  const level = briefing.metrics.riskLevel;

  return (
    <section
      aria-label="Executive briefing"
      className="relative overflow-hidden rounded-xl border border-navy-700 bg-navy-800 p-5 pl-7 sm:p-6 sm:pl-8"
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${BAR_CLASS[urgency]}`} />
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
        <span>Current position</span>
        <span aria-hidden="true">·</span>
        <span className={`font-semibold ${RISK_TEXT[level]}`}>Risk {capitalise(level)}</span>
      </div>
      <p className="mt-3 text-base leading-relaxed text-slate-100 sm:text-lg">{briefing.summary}</p>
      {line && <p className="mt-3 text-sm font-medium text-amber-300">{line}</p>}
    </section>
  );
}
