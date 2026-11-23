/**
 * Pure UTC date helpers for CASHFLOW AI.
 *
 * All dates are "YYYY-MM-DD" strings. Every computation uses UTC methods
 * (Date.UTC / getUTC*) so results never depend on the machine timezone.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for strict YYYY-MM-DD strings that name a real calendar date. */
export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(s);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Parse a validated YYYY-MM-DD string as UTC midnight. Only call on validated input. */
export function toUtcMs(iso: string): number {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) throw new Error(`Invalid ISO date: ${iso}`);
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/** Format a UTC epoch-millisecond value as YYYY-MM-DD. */
export function fromUtcMs(ms: number): string {
  const date = new Date(ms);
  return formatParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Add a whole number of days to an ISO date. */
export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * MS_PER_DAY);
}

/** Integer number of days from `from` to `to` (to - from). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/**
 * Add calendar months, clamping the day to the last day of the target month.
 * e.g. 2025-01-31 + 1 month = 2025-02-28.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) throw new Error(`Invalid ISO date: ${iso}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  const totalMonths = monthIndex + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth + 1));

  return formatParts(targetYear, targetMonth + 1, targetDay);
}

/** Ordering for ISO date strings: negative if a < b, 0 if equal, positive if a > b. */
export function compareIso(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Number of days in a 1-based month, computed in UTC. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of `month`.
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function formatParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
