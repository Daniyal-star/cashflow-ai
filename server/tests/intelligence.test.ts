import { describe, expect, it } from "vitest";
import type { Customer, Dataset, Invoice, Payment } from "../../shared/types.js";
import {
  computeCustomerIntelligence,
  customerIntelligenceFor,
} from "../src/core/customerIntelligence.js";

const settings = {
  openingBalance: 0,
  safetyBuffer: 0,
  asOfDate: "2025-06-15",
  forecastHorizonDays: 30,
  defaultPaymentDelayDays: 10,
  overdueCollectionDelayDays: 14,
};

function cust(id: string): Customer {
  return { id, name: `Name ${id}`, isDemoData: false };
}

function inv(id: string, customerId: string, amount: number, dueDate: string, extra: Partial<Invoice> = {}): Invoice {
  return {
    id,
    invoiceNumber: id,
    customerId,
    issueDate: "2025-01-01",
    dueDate,
    amount,
    status: "sent",
    ...extra,
  };
}

function pay(id: string, invoiceId: string, date: string, amount: number): Payment {
  return { id, invoiceId, date, amount, isDemoData: false };
}

function ds(customers: Customer[], invoices: Invoice[], payments: Payment[]): Dataset {
  return { settings, customers, invoices, payments, expenses: [] };
}

function byId(dataset: Dataset, id: string) {
  const found = computeCustomerIntelligence(dataset).find((item) => item.customerId === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("customer intelligence: history and classification", () => {
  it("classifies two settled invoices as insufficient data", () => {
    const dataset = ds(
      [cust("A")],
      [inv("a1", "A", 1000, "2025-03-01"), inv("a2", "A", 1000, "2025-04-01")],
      [pay("p1", "a1", "2025-03-01", 1000), pay("p2", "a2", "2025-04-01", 1000)],
    );
    const result = byId(dataset, "A");
    expect(result.classification).toBe("insufficient_data");
    expect(result.reliabilityScore).toBeNull();
    expect(result.averagePaymentDelayDays).toBeNull();
    expect(result.reliabilityExplanation.startsWith("Insufficient data")).toBe(true);
  });

  it("handles a customer with no invoices without NaN", () => {
    const dataset = ds([cust("Z")], [], []);
    const result = byId(dataset, "Z");
    expect(result.settledInvoiceCount).toBe(0);
    expect(result.outstanding).toBe(0);
    expect(result.classification).toBe("insufficient_data");
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("classifies on-time payers as reliable with score 100", () => {
    const dataset = ds(
      [cust("R")],
      [
        inv("r1", "R", 1000, "2025-03-01"),
        inv("r2", "R", 1000, "2025-04-01"),
        inv("r3", "R", 1000, "2025-05-01"),
      ],
      [
        pay("p1", "r1", "2025-03-01", 1000),
        pay("p2", "r2", "2025-04-01", 1000),
        pay("p3", "r3", "2025-05-01", 1000),
      ],
    );
    const result = byId(dataset, "R");
    expect(result.settledInvoiceCount).toBe(3);
    expect(result.onTimeRatio).toBe(1);
    expect(result.averagePaymentDelayDays).toBe(0);
    expect(result.classification).toBe("reliable");
    expect(result.reliabilityScore).toBe(100);
    expect(result.riskReasons).toEqual([]);
    expect(result.riskLevel).toBe("low");
  });

  it("classifies 20-day-late payers as consistently late with score 42", () => {
    const dataset = ds(
      [cust("L")],
      [
        inv("l1", "L", 1000, "2025-03-01"),
        inv("l2", "L", 1000, "2025-04-01"),
        inv("l3", "L", 1000, "2025-05-01"),
      ],
      [
        pay("p1", "l1", "2025-03-21", 1000),
        pay("p2", "l2", "2025-04-21", 1000),
        pay("p3", "l3", "2025-05-21", 1000),
      ],
    );
    const result = byId(dataset, "L");
    expect(result.averagePaymentDelayDays).toBe(20);
    expect(result.classification).toBe("consistently_late");
    expect(result.reliabilityScore).toBe(42);
    expect(Number.isInteger(result.reliabilityScore)).toBe(true);
  });
});

describe("customer intelligence: payments and cancellations", () => {
  it("does not settle a partially paid invoice; its balance is overdue", () => {
    const dataset = ds(
      [cust("P")],
      [inv("p1", "P", 10000, "2025-05-01")],
      [pay("x1", "p1", "2025-05-05", 4000)],
    );
    const result = byId(dataset, "P");
    expect(result.settledInvoiceCount).toBe(0);
    expect(result.outstanding).toBe(6000);
    expect(result.overdueAmount).toBe(6000);
  });

  it("ignores payments dated after the as-of date", () => {
    const dataset = ds(
      [cust("F")],
      [inv("f1", "F", 1000, "2025-06-01")],
      [pay("x1", "f1", "2025-06-20", 1000)],
    );
    const result = byId(dataset, "F");
    expect(result.settledInvoiceCount).toBe(0);
    expect(result.outstanding).toBe(1000);
  });

  it("ignores cancelled invoices for history and outstanding", () => {
    const dataset = ds(
      [cust("C")],
      [inv("c1", "C", 5000, "2025-05-01", { cancelled: true })],
      [],
    );
    const result = byId(dataset, "C");
    expect(result.outstanding).toBe(0);
    expect(result.overdueAmount).toBe(0);
    expect(result.settledInvoiceCount).toBe(0);
  });
});

describe("customer intelligence: concentration and risk", () => {
  it("flags customers at or above 40% of total outstanding", () => {
    const dataset = ds(
      [cust("X"), cust("Y"), cust("W")],
      [inv("x1", "X", 6000, "2025-07-01"), inv("y1", "Y", 4000, "2025-07-01")],
      [],
    );
    const x = byId(dataset, "X");
    const y = byId(dataset, "Y");
    const w = byId(dataset, "W");
    expect(x.concentrationShare).toBe(0.6);
    expect(x.concentrationFlag).toBe(true);
    expect(y.concentrationShare).toBe(0.4);
    expect(y.concentrationFlag).toBe(true);
    expect(w.concentrationFlag).toBe(false);
  });

  it("ranks a customer 35 days overdue as critical at rank 1", () => {
    const dataset = ds(
      [cust("N"), cust("O")],
      [inv("o1", "O", 1000, "2025-05-11")],
      [],
    );
    const overdue = byId(dataset, "O");
    const none = byId(dataset, "N");
    expect(overdue.maxDaysOverdue).toBe(35);
    expect(overdue.riskLevel).toBe("critical");
    expect(overdue.riskRank).toBe(1);
    expect(none.riskRank).toBeGreaterThan(1);
    expect(Array.isArray(overdue.riskReasons)).toBe(true);
    expect(overdue.riskReasons.every((r) => typeof r === "string")).toBe(true);
  });

  it("is deterministic and customerIntelligenceFor handles unknown ids", () => {
    const dataset = ds(
      [cust("A"), cust("B")],
      [inv("a1", "A", 1000, "2025-05-11"), inv("b1", "B", 2000, "2025-07-01")],
      [],
    );
    expect(computeCustomerIntelligence(dataset)).toEqual(computeCustomerIntelligence(dataset));
    expect(customerIntelligenceFor(dataset, "missing")).toBeUndefined();
    expect(customerIntelligenceFor(dataset, "A")?.customerId).toBe("A");
  });
});
