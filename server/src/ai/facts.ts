/**
 * Pure display helpers for the AI CFO briefing.
 *
 * Money is integer paise; output is rupee text with Indian digit grouping and no decimals.
 * No arithmetic on financial values happens here beyond unit conversion and rounding for display.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 4000000 paise -> "₹40,000"; -150000 -> "-₹1,500". Rounds to the nearest rupee. */
export function formatRupees(paise: number): string {
  const rupees = Math.round(Math.abs(paise) / 100);
  const digits = String(rupees);
  const grouped =
    digits.length <= 3
      ? digits
      : `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
  const sign = paise < 0 && rupees > 0 ? "-" : "";
  return `${sign}₹${grouped}`;
}

/** "2025-07-01" -> "1 Jul 2025" (UTC month names). Returns the input unchanged when it is not a YYYY-MM-DD string. */
export function formatDateLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return iso;
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}
