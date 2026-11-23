import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "./States";
import { formatINR, formatShortDate } from "../lib/format";
import type { ForecastDay } from "../../../shared/types";

const GRID = "#1a2947";
const TICK = "#94a3b8";

const tooltipStyle = {
  background: "#0f1d38",
  border: "1px solid #1a2947",
  borderRadius: 8,
  color: "#e2e8f0",
};

export function CashCharts({ days, safetyBuffer }: { days: ForecastDay[]; safetyBuffer: number }) {
  if (days.length === 0) {
    return (
      <EmptyState title="No forecast data" body="There are no forecast days to chart yet." />
    );
  }

  const balanceData = days.map((d) => ({ label: formatShortDate(d.date), balance: d.balance }));
  const flowData = days.map((d) => ({
    label: formatShortDate(d.date),
    incoming: d.incoming,
    outgoing: d.outgoing,
  }));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Projected cash balance</h2>
        <div className="mt-4 h-[260px]">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={balanceData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: TICK, fontSize: 12 }} stroke={GRID} minTickGap={16} />
              <YAxis
                tick={{ fill: TICK, fontSize: 12 }}
                stroke={GRID}
                tickFormatter={(v: number) => `₹${(v / 100000).toFixed(1)}L`}
                width={70}
              />
              <Tooltip
                formatter={(v) => formatINR(Number(v))}
                contentStyle={tooltipStyle}
                labelStyle={{ color: "#94a3b8" }}
              />
              <ReferenceLine y={0} stroke="#f87171" />
              <ReferenceLine y={safetyBuffer} stroke="#fbbf24" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#2dd4bf"
                fill="#2dd4bf"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Daily inflows vs outflows</h2>
        <div className="mt-4 h-[260px]">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={flowData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: TICK, fontSize: 12 }} stroke={GRID} minTickGap={16} />
              <YAxis
                tick={{ fill: TICK, fontSize: 12 }}
                stroke={GRID}
                tickFormatter={(v: number) => `₹${(v / 100000).toFixed(1)}L`}
                width={70}
              />
              <Tooltip
                formatter={(v) => formatINR(Number(v))}
                contentStyle={tooltipStyle}
                labelStyle={{ color: "#94a3b8" }}
              />
              <Legend wrapperStyle={{ color: TICK, fontSize: 12 }} />
              <Bar dataKey="incoming" name="Incoming" fill="#2dd4bf" />
              <Bar dataKey="outgoing" name="Outgoing" fill="#f87171" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
