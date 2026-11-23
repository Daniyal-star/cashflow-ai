import type { RiskLevel, RiskSeverity } from "../../../shared/types";

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function formatDateLabel(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatShortDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

export type Tone = "neutral" | "teal" | "amber" | "orange" | "red";

export function riskTone(level: RiskLevel): Tone {
  switch (level) {
    case "low":
      return "teal";
    case "medium":
      return "amber";
    case "high":
      return "orange";
    case "critical":
      return "red";
    default:
      return "red";
  }
}

export const SEVERITY_BADGE: Record<RiskSeverity, string> = {
  low: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  critical: "bg-red-500/15 text-red-300 border-red-500/30",
};
