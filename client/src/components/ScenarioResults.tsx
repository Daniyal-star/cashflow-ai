import { ComparisonChart, type ComparisonPoint } from "./ForecastCharts";
import { formatDateLabel, formatDays, formatINR, formatShortDate } from "../lib/format";
import type { RiskLevel, ScenarioComparison } from "../../../shared/types";

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];
const TONE_CLASS = { better: "text-teal-300", worse: "text-red-300", same: "text-slate-200" } as const;
type Direction = keyof typeof TONE_CLASS;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function signedINR(paise: number): string {
  return `${paise > 0 ? "+" : ""}${formatINR(paise)}`;
}

function shortageLabel(date: string | null): string {
  return date ? formatDateLabel(date) : "None";
}

/** Direction of change for a value where higher is better. */
function higherIsBetter(before: number, after: number): Direction {
  if (after > before) return "better";
  if (after < before) return "worse";
  return "same";
}

/** Direction of change for a value where lower is better. */
function lowerIsBetter(before: number, after: number): Direction {
  return higherIsBetter(-before, -after);
}

function shortageDirection(before: string | null, after: string | null): Direction {
  if (before === after) return "same";
  if (before === null) return "worse";
  if (after === null) return "better";
  return after < before ? "worse" : "better";
}

interface Row {
  label: string;
  before: string;
  after: string;
  change: string;
  direction: Direction;
}

function buildRows(c: ScenarioComparison): Row[] {
  const endBefore = c.baseline.days[c.baseline.days.length - 1];
  const endAfter = c.scenario.days[c.scenario.days.length - 1];
  const rows: Row[] = [];

  rows.push({
    label: "Ending balance",
    before: endBefore ? formatINR(endBefore.balance) : "—",
    after: endAfter ? formatINR(endAfter.balance) : "—",
    change: signedINR(c.balanceDifference),
    direction: higherIsBetter(0, c.balanceDifference),
  });

  rows.push({
    label: "Minimum balance",
    before: formatINR(c.baseline.minimumBalance),
    after: formatINR(c.scenario.minimumBalance),
    change: signedINR(c.minimumBalanceDifference),
    direction: higherIsBetter(0, c.minimumBalanceDifference),
  });

  rows.push({
    label: "Shortage date",
    before: shortageLabel(c.shortageDateBefore),
    after: shortageLabel(c.shortageDateAfter),
    change: "—",
    direction: shortageDirection(c.shortageDateBefore, c.shortageDateAfter),
  });

  rows.push({
    label: "Shortage amount",
    before: formatINR(c.shortageAmountBefore),
    after: formatINR(c.shortageAmountAfter),
    change: "—",
    direction: lowerIsBetter(c.shortageAmountBefore, c.shortageAmountAfter),
  });

  const riskBefore = RISK_ORDER.indexOf(c.riskLevelBefore);
  const riskAfter = RISK_ORDER.indexOf(c.riskLevelAfter);
  rows.push({
    label: "Risk level",
    before: capitalise(c.riskLevelBefore),
    after: capitalise(c.riskLevelAfter),
    change: "—",
    direction: lowerIsBetter(riskBefore, riskAfter),
  });

  rows.push({
    label: "Cash runway",
    before: formatDays(c.runwayDaysBefore),
    after: formatDays(c.runwayDaysAfter),
    change: `${c.runwayDaysAfter - c.runwayDaysBefore > 0 ? "+" : ""}${c.runwayDaysAfter - c.runwayDaysBefore} days`,
    direction: higherIsBetter(c.runwayDaysBefore, c.runwayDaysAfter),
  });

  return rows;
}

function changedFields(c: ScenarioComparison): string[] {
  const changed: string[] = [];
  if (c.balanceDifference !== 0) changed.push("ending balance");
  if (c.minimumBalanceDifference !== 0) changed.push("minimum balance");
  if (c.shortageDateBefore !== c.shortageDateAfter) changed.push("shortage date");
  if (c.shortageAmountBefore !== c.shortageAmountAfter) changed.push("shortage amount");
  if (c.riskLevelBefore !== c.riskLevelAfter) changed.push("risk level");
  if (c.runwayDaysBefore !== c.runwayDaysAfter) changed.push("cash runway");
  return changed;
}

export function ScenarioResults({ comparison, days }: { comparison: ScenarioComparison; days: number }) {
  const rows = buildRows(comparison);
  const changed = changedFields(comparison);
  const dayWord = days === 1 ? "day" : "days";
  const explanation =
    changed.length > 0
      ? `Payment delayed by ${days} ${dayWord}. Changed: ${changed.join(", ")}.`
      : `Payment delayed by ${days} ${dayWord}. No fields changed.`;

  const points: ComparisonPoint[] = comparison.baseline.days.map((d, i) => ({
    label: formatShortDate(d.date),
    baseline: d.balance,
    scenario: comparison.scenario.days[i]?.balance ?? d.balance,
  }));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Baseline vs scenario</h2>
        <p className="mt-2 text-sm text-slate-400">{explanation}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Metric</th>
                <th className="py-2 pr-4 text-right font-medium">Baseline</th>
                <th className="py-2 pr-4 text-right font-medium">Scenario</th>
                <th className="py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="py-2 pr-4 text-slate-300">{r.label}</td>
                  <td className="py-2 pr-4 text-right num text-slate-300">{r.before}</td>
                  <td className={`py-2 pr-4 text-right num font-medium ${TONE_CLASS[r.direction]}`}>{r.after}</td>
                  <td className={`py-2 text-right num ${TONE_CLASS[r.direction]}`}>{r.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ComparisonChart points={points} />
    </div>
  );
}
