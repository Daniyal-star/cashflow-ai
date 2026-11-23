/**
 * Zod schemas for Milestone 4 scenario requests (POST /api/forecast/scenario).
 *
 * Money is integer paise. Dates are "YYYY-MM-DD" and must name a real calendar date.
 * Existence of customerId / invoiceId / expenseId is NOT checked here; the route does that against the dataset.
 */

import { z } from "zod";
import { isValidIsoDate } from "../core/dates.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD")
  .refine(isValidIsoDate, "Invalid calendar date");

const MAX_MONEY_PAISE = 100000000000;
const MAX_DELAY_DAYS = 365;
const MAX_PERCENT = 500;

const id = z.string().trim().min(1, "Id is required");
const delayDays = z
  .number()
  .int("days must be an integer")
  .min(0, "days must be at least 0")
  .max(MAX_DELAY_DAYS, `days must be at most ${MAX_DELAY_DAYS}`);
const percent = z
  .number()
  .int("percent must be an integer")
  .min(0, "percent must be at least 0")
  .max(MAX_PERCENT, `percent must be at most ${MAX_PERCENT}`);
const paise = z
  .number()
  .int("amount must be an integer number of paise")
  .positive("amount must be greater than 0")
  .max(MAX_MONEY_PAISE, "amount is too large");

const customerDelaySchema = z.object({
  type: z.literal("customer_delay"),
  customerId: id,
  days: delayDays,
});

const customerPartialPaymentSchema = z.object({
  type: z.literal("customer_partial_payment"),
  customerId: id,
  amount: paise,
  expectedDate: isoDate,
});

const customerEarlyPaymentSchema = z.object({
  type: z.literal("customer_early_payment"),
  customerId: id,
  days: delayDays,
});

const newExpenseSchema = z.object({
  type: z.literal("new_expense"),
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be at most 120 characters"),
  amount: paise,
  date: isoDate,
  recurrence: z.enum(["none", "weekly", "monthly"]),
});

const expenseIncreaseSchema = z.object({
  type: z.literal("expense_increase"),
  expenseId: id,
  percent,
});

const expensePostponementSchema = z.object({
  type: z.literal("expense_postponement"),
  expenseId: id,
  days: delayDays,
  occurrenceDate: isoDate.optional(),
});

const rentIncreaseSchema = z.object({
  type: z.literal("rent_increase"),
  expenseId: id,
  percent,
});

const supplierPaymentChangeSchema = z.object({
  type: z.literal("supplier_payment_change"),
  expenseId: id,
  amount: paise,
});

const invoiceDelaySchema = z.object({
  type: z.literal("invoice_delay"),
  invoiceId: id,
  days: delayDays,
});

/** Discriminated union on `type`; every variant of ScenarioAdjustment in shared/types.ts is covered. */
export const adjustmentSchema = z.discriminatedUnion("type", [
  customerDelaySchema,
  customerPartialPaymentSchema,
  customerEarlyPaymentSchema,
  newExpenseSchema,
  expenseIncreaseSchema,
  expensePostponementSchema,
  rentIncreaseSchema,
  supplierPaymentChangeSchema,
  invoiceDelaySchema,
]);

export const scenarioRequestSchema = z.object({
  adjustments: z.array(adjustmentSchema).max(10, "At most 10 adjustments are allowed"),
});

export type ScenarioRequest = z.infer<typeof scenarioRequestSchema>;
