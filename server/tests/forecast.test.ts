import { describe, it, expect } from "vitest";
import { forecastCashFlow } from "../src/core/forecast.js";
import type { Customer, Dataset, Expense, ForecastDay, ForecastResult, Invoice, Payment, Settings } from "../../shared/types.js";

const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Alpha Traders", isDemoData: true },
  { id: "c2", name: "Beta Stores", isDemoData: true },
];

/**
 * Small hand-made dataset. Defaults: asOf 2025-06-15, horizon 30 (to 2025-07-15),
 * defaultPaymentDelayDays 10, overdueCollectionDelayDays 14, safetyBuffer 0.
 * openingBalance defaults to 0 and should be stated per test where it matters.
 */
function makeDataset(
  overrides: {
    settings?: Partial<Settings>;
    customers?: Customer[];
    invoices?: Invoice[];
    payments?: Payment[];
    expenses?: Expense[];
  } = {},
): Dataset {
  return {
    settings: {
      openingBalance: 0,
      safetyBuffer: 0,
      asOfDate: "2025-06-15",
      forecastHorizonDays: 30,
      defaultPaymentDelayDays: 10,
      overdueCollectionDelayDays: 14,
      ...overrides.settings,
    },
    customers: overrides.customers ?? CUSTOMERS,
    invoices: overrides.invoices ?? [],
    payments: overrides.payments ?? [],
    expenses: overrides.expenses ?? [],
  };
}

function makeInvoice(overrides: Partial<Invoice> & Pick<Invoice, "id" | "dueDate" | "amount">): Invoice {
  return {
    invoiceNumber: `INV-${overrides.id}`,
    customerId: "c1",
    issueDate: "2025-05-01",
    status: "sent",
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> & Pick<Expense, "id" | "dueDate" | "amount">): Expense {
  return {
    name: `Expense ${overrides.id}`,
    category: "test",
    recurrence: "none",
    isDemoData: true,
    ...overrides,
  };
}

function dayOn(result: ForecastResult, date: string): ForecastDay {
  const day = result.days.find((d) => d.date === date);
  if (!day) throw new Error(`No forecast day for ${date}`);
  return day;
}

function outgoingDates(result: ForecastResult): string[] {
  return result.days.filter((d) => d.outgoing > 0).map((d) => d.date);
}

function totalIncoming(result: ForecastResult): number {
  return result.days.reduce((sum, d) => sum + d.incoming, 0);
}

describe("forecastCashFlow", () => {
  it("keeps the balance flat at opening when there are no invoices or expenses", () => {
    const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 500_000 } }));

    expect(result.days).toHaveLength(30);
    expect(result.days.every((d) => d.balance === 500_000)).toBe(true);
    expect(result.minimumBalance).toBe(500_000);
    expect(result.shortageDate).toBeNull();
    expect(result.cashRunwayDays).toBe(30);
  });

  it("contributes nothing for an invoice already fully paid", () => {
    const invoice = makeInvoice({ id: "paid", dueDate: "2025-06-20", amount: 300_000, status: "paid" });
    const payment: Payment = { id: "p1", invoiceId: "paid", date: "2025-06-10", amount: 300_000, isDemoData: true };
    const result = forecastCashFlow(
      makeDataset({ settings: { openingBalance: 1_000_000 }, invoices: [invoice], payments: [payment] }),
    );

    expect(totalIncoming(result)).toBe(0);
    expect(result.days.every((d) => d.balance === 1_000_000)).toBe(true);
  });

  it("collects only the remaining balance of a partially paid invoice on due date + 10", () => {
    // Due 2025-06-20 (not yet overdue) -> expected 2025-06-30, which is asOf + 15 (index 14).
    const invoice = makeInvoice({ id: "part", dueDate: "2025-06-20", amount: 1_000_000, status: "partially_paid" });
    const payment: Payment = { id: "p1", invoiceId: "part", date: "2025-06-01", amount: 400_000, isDemoData: true };
    const result = forecastCashFlow(makeDataset({ invoices: [invoice], payments: [payment] }));

    expect(dayOn(result, "2025-06-29").incoming).toBe(0);
    expect(dayOn(result, "2025-06-30").incoming).toBe(600_000);
    expect(dayOn(result, "2025-06-30").balance).toBe(600_000);
    expect(totalIncoming(result)).toBe(600_000);
  });

  it("ignores a cancelled invoice", () => {
    const cancelled = makeInvoice({ id: "x1", dueDate: "2025-06-20", amount: 500_000, status: "cancelled" });
    const flagged = makeInvoice({ id: "x2", dueDate: "2025-06-20", amount: 700_000, cancelled: true });
    const result = forecastCashFlow(makeDataset({ invoices: [cancelled, flagged] }));

    expect(totalIncoming(result)).toBe(0);
  });

  it("collects an overdue invoice on as-of date + 14", () => {
    // Due 2025-05-01 is before asOf -> expected 2025-06-29, which is asOf + 14 (index 13).
    const invoice = makeInvoice({ id: "od", dueDate: "2025-05-01", amount: 200_000 });
    const result = forecastCashFlow(makeDataset({ invoices: [invoice] }));

    expect(dayOn(result, "2025-06-28").incoming).toBe(0);
    expect(dayOn(result, "2025-06-29").incoming).toBe(200_000);
    expect(totalIncoming(result)).toBe(200_000);
  });

  it("reduces the balance on the due date of a non-recurring expense inside the horizon", () => {
    const expense = makeExpense({ id: "e1", dueDate: "2025-06-25", amount: 150_000 });
    const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 1_000_000 }, expenses: [expense] }));

    expect(dayOn(result, "2025-06-24").balance).toBe(1_000_000);
    expect(dayOn(result, "2025-06-25").outgoing).toBe(150_000);
    expect(dayOn(result, "2025-06-25").balance).toBe(850_000);
    expect(result.days[29].balance).toBe(850_000);
  });

  it("skips a non-recurring expense dated before asOf as settled, without a warning", () => {
    // Changed: the as-of policy now treats every occurrence strictly before asOf as settled (one policy for one-off and recurring).
    const expense = makeExpense({ id: "late", dueDate: "2025-06-01", amount: 100_000 });
    const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 1_000_000 }, expenses: [expense] }));

    expect(outgoingDates(result)).toEqual([]);
    expect(result.warnings.some((w) => w.includes("as-of date"))).toBe(false);
  });

  it("repeats a weekly expense every 7 days within the horizon", () => {
    const expense = makeExpense({ id: "wk", dueDate: "2025-06-18", amount: 10_000, recurrence: "weekly" });
    const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 1_000_000 }, expenses: [expense] }));

    expect(outgoingDates(result)).toEqual(["2025-06-18", "2025-06-25", "2025-07-02", "2025-07-09"]);
    expect(result.days.filter((d) => d.outgoing > 0).every((d) => d.outgoing === 10_000)).toBe(true);
  });

  it("produces one monthly occurrence per month inside a 60-day horizon", () => {
    const expense = makeExpense({ id: "mo", dueDate: "2025-06-20", amount: 10_000, recurrence: "monthly" });
    const result = forecastCashFlow(
      makeDataset({ settings: { openingBalance: 1_000_000, forecastHorizonDays: 60 }, expenses: [expense] }),
    );

    expect(result.days).toHaveLength(60);
    expect(outgoingDates(result)).toEqual(["2025-06-20", "2025-07-20"]);
  });

  it("clamps a monthly expense from the 31st to month end without crashing", () => {
    const expense = makeExpense({ id: "clamp", dueDate: "2025-01-31", amount: 10_000, recurrence: "monthly" });
    // A thrown error here fails the test; no separate not.toThrow() needed.
    const result = forecastCashFlow(
      makeDataset({ settings: { openingBalance: 1_000_000, forecastHorizonDays: 60 }, expenses: [expense] }),
    );

    // Occurrences on/after asOf: 2025-06-30 (June has no 31st) and 2025-07-31.
    expect(outgoingDates(result)).toEqual(["2025-06-30", "2025-07-31"]);
  });

  it("handles a zero opening balance with no activity as neither negative nor short", () => {
    const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 0 } }));

    expect(result.minimumBalance).toBe(0);
    expect(result.shortageDate).toBeNull();
    expect(result.shortageAmount).toBe(0);
    expect(result.cashRunwayDays).toBe(30);
  });

  it("reports a shortage starting asOf + 1 when the opening balance is negative", () => {
    const result = forecastCashFlow(makeDataset({ settings: { openingBalance: -500_000 } }));

    expect(result.minimumBalance).toBe(-500_000);
    expect(result.shortageDate).toBe("2025-06-16");
    expect(result.shortageAmount).toBe(-result.minimumBalance);
    expect(result.shortageAmount).toBe(500_000);
    expect(result.cashRunwayDays).toBe(1);
  });

  it("skips an invoice with an invalid dueDate and records a warning instead of throwing", () => {
    const bad = makeInvoice({ id: "bad", invoiceNumber: "INV-BAD", dueDate: "2025-13-01", amount: 400_000 });
    // A thrown error here fails the test, so the call itself is the no-throw check.
    const result = forecastCashFlow(makeDataset({ invoices: [bad] }));

    expect(totalIncoming(result)).toBe(0);
    expect(result.warnings).toContain("Invoice INV-BAD skipped: invalid dueDate");
  });

  it("throws when asOfDate is not a valid calendar date", () => {
    expect(() => forecastCashFlow(makeDataset({ settings: { asOfDate: "2025-02-30" } }))).toThrow("Invalid asOfDate");
  });

  it("is deterministic for identical input", () => {
    const dataset = makeDataset({
      settings: { openingBalance: 250_000 },
      invoices: [makeInvoice({ id: "d1", dueDate: "2025-06-22", amount: 90_000 })],
      expenses: [makeExpense({ id: "d2", dueDate: "2025-06-19", amount: 30_000, recurrence: "weekly" })],
    });

    const first = forecastCashFlow(dataset);
    const second = forecastCashFlow(dataset);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("moves a customer's collection later when a 15-day customer_delay is applied", () => {
    // Due 2025-06-20 -> baseline expected 2025-06-30 (index 14); delayed by 15 -> 2025-07-15 (index 29, last day).
    const invoice = makeInvoice({ id: "delay", customerId: "c1", dueDate: "2025-06-20", amount: 1_000_000 });
    const dataset = makeDataset({ invoices: [invoice] });

    const baseline = forecastCashFlow(dataset);
    const scenario = forecastCashFlow(dataset, {
      adjustments: [{ type: "customer_delay", customerId: "c1", days: 15 }],
    });

    expect(dayOn(baseline, "2025-06-30").incoming).toBe(1_000_000);
    expect(dayOn(scenario, "2025-06-30").incoming).toBe(0);
    expect(dayOn(scenario, "2025-06-30").balance).toBeLessThan(dayOn(baseline, "2025-06-30").balance);
    expect(dayOn(scenario, "2025-07-15").incoming).toBe(1_000_000);
  });

  describe("customer_partial_payment (oldest-due-first)", () => {
    // A: 5,000,000 due 06-20 -> expected 06-30. B: 3,000,000 due 06-25 -> expected 07-05.
    const invoices = [
      makeInvoice({ id: "A", dueDate: "2025-06-20", amount: 5_000_000 }),
      makeInvoice({ id: "B", dueDate: "2025-06-25", amount: 3_000_000 }),
    ];
    const partial = (amount: number) => ({
      type: "customer_partial_payment" as const,
      customerId: "c1",
      amount,
      expectedDate: "2025-07-01",
    });

    it("applies 4,000,000 to A first and keeps the remainders on their normal dates", () => {
      const result = forecastCashFlow(makeDataset({ invoices }), { adjustments: [partial(4_000_000)] });

      expect(dayOn(result, "2025-07-01").incoming).toBe(4_000_000);
      expect(dayOn(result, "2025-06-30").incoming).toBe(1_000_000); // A remainder
      expect(dayOn(result, "2025-07-05").incoming).toBe(3_000_000); // B untouched
      expect(totalIncoming(result)).toBe(8_000_000);
    });

    it("collects everything on the expected date when the payment covers all receivables", () => {
      const result = forecastCashFlow(makeDataset({ invoices }), { adjustments: [partial(9_000_000)] });

      expect(dayOn(result, "2025-07-01").incoming).toBe(8_000_000);
      expect(dayOn(result, "2025-06-30").incoming).toBe(0);
      expect(dayOn(result, "2025-07-05").incoming).toBe(0);
      expect(totalIncoming(result)).toBe(8_000_000);
    });

    it("never loses the remainder: total incoming equals total remaining for partial and full payments", () => {
      const baseline = totalIncoming(forecastCashFlow(makeDataset({ invoices })));
      const small = totalIncoming(forecastCashFlow(makeDataset({ invoices }), { adjustments: [partial(4_000_000)] }));
      const large = totalIncoming(forecastCashFlow(makeDataset({ invoices }), { adjustments: [partial(9_000_000)] }));

      expect(baseline).toBe(8_000_000);
      expect(small).toBe(baseline);
      expect(large).toBe(baseline);
    });
  });

  describe("as-of date expense policy", () => {
    it("treats a one-off expense due exactly on asOf as due asOf + 1 with a warning", () => {
      const expense = makeExpense({ id: "onasof", name: "Rent", dueDate: "2025-06-15", amount: 100_000 });
      const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 1_000_000 }, expenses: [expense] }));

      expect(outgoingDates(result)).toEqual(["2025-06-16"]);
      expect(dayOn(result, "2025-06-16").outgoing).toBe(100_000);
      expect(result.warnings.some((w) => w.includes("Rent") && w.includes("as-of date"))).toBe(true);
    });

    it("counts a monthly expense due exactly on asOf on asOf + 1 and keeps the next normal occurrence", () => {
      const expense = makeExpense({ id: "moasof", name: "Power", dueDate: "2025-06-15", amount: 100_000, recurrence: "monthly" });
      const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 1_000_000 }, expenses: [expense] }));

      expect(outgoingDates(result)).toEqual(["2025-06-16", "2025-07-15"]);
      expect(dayOn(result, "2025-06-16").outgoing).toBe(100_000);
      expect(dayOn(result, "2025-07-15").outgoing).toBe(100_000);
      expect(result.warnings.some((w) => w.includes("Power") && w.includes("as-of date"))).toBe(true);
    });

    it("does not count occurrences dated asOf - 1 (one-off or recurring)", () => {
      const oneOff = makeExpense({ id: "prev1", dueDate: "2025-06-14", amount: 100_000 });
      const monthly = makeExpense({ id: "prev2", dueDate: "2025-06-14", amount: 50_000, recurrence: "monthly" });
      const result = forecastCashFlow(makeDataset({ settings: { openingBalance: 1_000_000 }, expenses: [oneOff, monthly] }));

      expect(outgoingDates(result)).toEqual(["2025-07-14"]);
      expect(dayOn(result, "2025-07-14").outgoing).toBe(50_000);
    });
  });

  describe("expense_postponement occurrence selection", () => {
    const rent = makeExpense({ id: "rent", name: "Rent", dueDate: "2025-07-01", amount: 4_500_000, recurrence: "monthly" });
    const rentDataset = () =>
      makeDataset({ settings: { openingBalance: 10_000_000, forecastHorizonDays: 60 }, expenses: [rent] });

    it("moves only the selected occurrence when occurrenceDate is given", () => {
      const result = forecastCashFlow(rentDataset(), {
        adjustments: [{ type: "expense_postponement", expenseId: "rent", days: 10, occurrenceDate: "2025-07-01" }],
      });

      expect(dayOn(result, "2025-07-01").outgoing).toBe(0);
      expect(dayOn(result, "2025-07-11").outgoing).toBe(4_500_000);
      expect(dayOn(result, "2025-08-01").outgoing).toBe(4_500_000);
      expect(outgoingDates(result)).toEqual(["2025-07-11", "2025-08-01"]);
    });

    it("postpones the first occurrence inside the horizon when occurrenceDate is omitted", () => {
      const result = forecastCashFlow(rentDataset(), {
        adjustments: [{ type: "expense_postponement", expenseId: "rent", days: 10 }],
      });

      expect(dayOn(result, "2025-07-01").outgoing).toBe(0);
      expect(dayOn(result, "2025-07-11").outgoing).toBe(4_500_000);
      expect(dayOn(result, "2025-08-01").outgoing).toBe(4_500_000);
      expect(result.assumptions.some((a) => a.includes("first monthly occurrence"))).toBe(true);
    });

    it("warns and changes nothing when occurrenceDate matches no generated occurrence", () => {
      const baseline = forecastCashFlow(rentDataset());
      const result = forecastCashFlow(rentDataset(), {
        adjustments: [{ type: "expense_postponement", expenseId: "rent", days: 10, occurrenceDate: "2025-07-02" }],
      });

      expect(outgoingDates(result)).toEqual(outgoingDates(baseline));
      expect(result.days).toEqual(baseline.days);
      expect(result.warnings.some((w) => w.includes("no generated occurrence on 2025-07-02"))).toBe(true);
    });
  });
});
