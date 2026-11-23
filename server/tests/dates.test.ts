import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonthsClamped,
  diffDays,
  fromUtcMs,
  isValidIsoDate,
  toUtcMs,
} from "../src/core/dates.js";

describe("isValidIsoDate", () => {
  it("accepts real calendar dates in YYYY-MM-DD form", () => {
    expect(isValidIsoDate("2025-06-15")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects a day that does not exist in the month", () => {
    expect(isValidIsoDate("2025-02-30")).toBe(false);
  });

  it("rejects non-zero-padded months and days", () => {
    expect(isValidIsoDate("2025-6-1")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidIsoDate(20250615)).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
    expect(isValidIsoDate(new Date(0))).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-06-15", 15)).toBe("2025-06-30");
  });

  it("crosses a year boundary and handles negative offsets", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
  });
});

describe("addMonthsClamped", () => {
  it("clamps 2025-01-31 + 1 month to 2025-02-28", () => {
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
  });

  it("respects leap years and year rollover", () => {
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2025-01-31", 12)).toBe("2026-01-31");
  });
});

describe("diffDays", () => {
  it("returns a positive count when the target is later", () => {
    expect(diffDays("2025-06-15", "2025-06-30")).toBe(15);
  });

  it("returns a negative count when the target is earlier", () => {
    expect(diffDays("2025-06-30", "2025-06-15")).toBe(-15);
  });
});

describe("fromUtcMs / toUtcMs", () => {
  it("round-trips a date through epoch milliseconds", () => {
    expect(fromUtcMs(toUtcMs("2024-02-29"))).toBe("2024-02-29");
  });

  it("parses the Unix epoch as UTC midnight", () => {
    expect(toUtcMs("1970-01-01")).toBe(0);
  });
});
