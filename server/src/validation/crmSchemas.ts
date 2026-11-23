/**
 * Zod schemas for Milestone 3 customer, invoice and payment input.
 *
 * Money is integer paise. Dates are "YYYY-MM-DD" and must name a real calendar date.
 * Empty optional strings ("") are normalised to undefined.
 */

import { z } from "zod";
import { isValidIsoDate } from "../core/dates.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD")
  .refine(isValidIsoDate, "Invalid calendar date");

const optionalEmail = z
  .union([z.string().trim().email("Invalid email address").max(254, "Email must be at most 254 characters"), z.literal("")])
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

const optionalPhone = z
  .union([
    z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Invalid phone number"),
    z.literal(""),
  ])
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be at most 120 characters"),
  email: optionalEmail,
  phone: optionalPhone,
});

export const customerUpdateSchema = customerInputSchema.partial();

const invoiceBaseSchema = z.object({
  invoiceNumber: z
    .string()
    .trim()
    .min(1, "Invoice number is required")
    .max(30, "Invoice number must be at most 30 characters"),
  customerId: z.string().min(1, "Customer is required"),
  issueDate: isoDate,
  dueDate: isoDate,
  amount: z.number().int().positive().max(100000000000),
  notes: z
    .string()
    .trim()
    .max(500, "Notes must be at most 500 characters")
    .optional(),
  cancelled: z.boolean().optional(),
});

const DUE_BEFORE_ISSUE_MESSAGE = "Due date must be on or after the issue date";

export const invoiceInputSchema = invoiceBaseSchema.refine(
  (invoice) => invoice.dueDate >= invoice.issueDate,
  { message: DUE_BEFORE_ISSUE_MESSAGE, path: ["dueDate"] },
);

export const invoiceUpdateSchema = invoiceBaseSchema.partial().refine(
  (invoice) =>
    invoice.issueDate === undefined ||
    invoice.dueDate === undefined ||
    invoice.dueDate >= invoice.issueDate,
  { message: DUE_BEFORE_ISSUE_MESSAGE, path: ["dueDate"] },
);

export const paymentInputSchema = z.object({
  date: isoDate,
  amount: z.number().int().positive(),
});

/** Flatten a Zod error to "path: message" entries joined with "; ". */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
