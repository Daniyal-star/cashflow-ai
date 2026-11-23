import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR, formatShortDate } from "../lib/format";
import type { ForecastDay } from "../../../shared/types";

export const CHART_GRID = "#1a2947";
export const CHART_TICK = "#94a3b8";

export const chartTooltipStyle = {
  background: "#0f1d38",
  border: "1px solid #1a2947",
  borderRadius: 8,
  color: "#e2e8f0",
};

/** Money is in paise; 1 lakh = 10,000,000 paise. */
export function formatLakhsTick(paise: number): string {
  return `₹${(paise / 10_000_000).toFixed(1)}L`;
}

const AXIS_TICK = { fill: CHART_TICK, fontSize: 12 };

export function ClosingCashChart({ days, safetyBuffer }: { days: ForecastDay[]; safetyBuffer: number }) {
  const data = days.map((d) => ({ label: formatShortDate(d.date), balance: d.balance }));

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Projected closing cash</h2>
      <div className="mt-4 h-[320px]">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS_TICK} stroke={CHART_GRID} minTickGap={16} />
            <YAxis tick={AXIS_TICK} stroke={CHART_GRID} tickFormatter={formatLakhsTick} width={70} />
            <Tooltip
              formatter={(v) => formatINR(Number(v))}
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: CHART_TICK }}
            />
            <ReferenceLine y={0} stroke="#f87171" />
            <ReferenceLine
              y={safetyBuffer}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              label={{ value: "Safety buffer", fill: "#fbbf24", fontSize: 12, position: "insideTopLeft" }}
            />
            <Area type="monotone" dataKey="balance" name="Closing balance" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.15} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FlowChart({ days }: { days: ForecastDay[] }) {
  const data = days.map((d) => ({
    label: formatShortDate(d.date),
    incoming: d.incoming,
    outgoing: d.outgoing,
  }));

  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Daily inflows and outflows</h2>
      <div className="mt-4 h-[260px]">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS_TICK} stroke={CHART_GRID} minTickGap={16} />
            <YAxis tick={AXIS_TICK} stroke={CHART_GRID} tickFormatter={formatLakhsTick} width={70} />
            <Tooltip
              formatter={(v) => formatINR(Number(v))}
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: CHART_TICK }}
            />
            <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
            <Bar dataKey="incoming" name="Incoming" fill="#2dd4bf" />
            <Bar dataKey="outgoing" name="Outgoing" fill="#f87171" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface ComparisonPoint {
  label: string;
  baseline: number;
  scenario: number;
}

/** Two-series balance comparison. Points are already aligned by day index by the caller. */
export function ComparisonChart({ points }: { points: ComparisonPoint[] }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Baseline vs scenario closing cash</h2>
      <div className="mt-4 h-[320px]">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS_TICK} stroke={CHART_GRID} minTickGap={16} />
            <YAxis tick={AXIS_TICK} stroke={CHART_GRID} tickFormatter={formatLakhsTick} width={70} />
            <Tooltip
              formatter={(v) => formatINR(Number(v))}
              contentStyle={chartTooltipStyle}
              labelStyle={{ color: CHART_TICK }}
            />
            <Legend wrapperStyle={{ color: CHART_TICK, fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#f87171" />
            <Line type="monotone" dataKey="baseline" name="Baseline" stroke="#94a3b8" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="scenario" name="Scenario" stroke="#2dd4bf" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
