/**
 * Money helpers for form input. All stored/transported money is integer paise.
 * Parsing is string-based so no floating-point rupees are ever stored.
 */

const RUPEE_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a rupee string such as "12,345.50" or "1500" into integer paise.
 * Returns null when the input is empty, not a number, has more than 2 decimals,
 * or is not strictly positive.
 */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "");
  if (!RUPEE_PATTERN.test(cleaned)) return null;

  const [wholePart, fractionPart = ""] = cleaned.split(".");
  const paise = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0"));

  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise;
}

/** Format integer paise as a plain two-decimal rupee string for inputs, e.g. 150000 → "1500.00". */
export function paiseToRupeInput(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const remainder = Math.abs(paise) % 100;
  return `${rupees}.${String(remainder).padStart(2, "0")}`;
}
