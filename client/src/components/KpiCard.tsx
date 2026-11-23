type KpiTone = "neutral" | "teal" | "amber" | "orange" | "red";

const BORDER_TONE: Record<KpiTone, string> = {
  neutral: "border-t-transparent",
  teal: "border-t-teal-400",
  amber: "border-t-amber-400",
  orange: "border-t-orange-400",
  red: "border-t-red-500",
};

const VALUE_TONE: Record<KpiTone, string> = {
  neutral: "text-slate-100",
  teal: "text-teal-300",
  amber: "text-amber-300",
  orange: "text-orange-300",
  red: "text-red-400",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
}) {
  return (
    <div className={`rounded-xl border border-navy-700 border-t-2 bg-navy-800 p-5 ${BORDER_TONE[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold num ${VALUE_TONE[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
