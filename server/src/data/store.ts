import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { Dataset } from "../../../shared/types.js";

/**
 * Persistence boundary for the forecast engine.
 * JsonDataStore is the current backend; a SQLite store can implement
 * DataRepository later without touching callers (see createDataStore).
 */
export interface DataRepository {
  load(): Dataset;
  save(dataset: Dataset): void;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const money = z.number().int();
const invoiceStatus = z.enum(["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"]);
const recurrence = z.enum(["none", "weekly", "monthly"]);

const settingsSchema = z.object({
  openingBalance: money,
  safetyBuffer: money,
  asOfDate: isoDate,
  forecastHorizonDays: z.number().int().nonnegative(),
  defaultPaymentDelayDays: z.number().int().nonnegative(),
  overdueCollectionDelayDays: z.number().int().nonnegative(),
});

const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  isDemoData: z.boolean(),
});

const invoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  customerId: z.string(),
  issueDate: isoDate,
  dueDate: isoDate,
  amount: money,
  status: invoiceStatus,
  cancelled: z.boolean().optional(),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  date: isoDate,
  amount: money,
  isDemoData: z.boolean(),
});

const expenseSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  amount: money,
  dueDate: isoDate,
  recurrence: recurrence,
  recurrenceEndDate: isoDate.optional(),
  isDemoData: z.boolean(),
});

const reminderSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  customerId: z.string(),
  tone: z.enum(["friendly", "professional", "firm"]),
  date: isoDate,
  balanceAtDraft: money,
  status: z.enum(["drafted", "sent"]),
  sentAt: isoDate.optional(),
  channels: z.array(z.enum(["whatsapp", "email"])),
  isDemoData: z.literal(false),
});

export const datasetSchema = z.object({
  settings: settingsSchema,
  customers: z.array(customerSchema),
  invoices: z.array(invoiceSchema),
  payments: z.array(paymentSchema),
  expenses: z.array(expenseSchema),
  // Optional for backward compatibility with datasets saved before Milestone 7.1.
  reminders: z.array(reminderSchema).optional(),
});

function summariseIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function validateDataset(value: unknown, source: string): Dataset {
  const result = datasetSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid dataset (${source}): ${summariseIssues(result.error)}`);
  }
  return result.data;
}

export class JsonDataStore implements DataRepository {
  constructor(private readonly filePath: string) {}

  load(): Dataset {
    if (!fs.existsSync(this.filePath)) {
      throw new Error(`Data file not found: ${this.filePath}`);
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Data file is not valid JSON: ${this.filePath} (${(err as Error).message})`);
    }
    return validateDataset(parsed, this.filePath);
  }

  save(dataset: Dataset): void {
    const validated = validateDataset(dataset, "save");

    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}

export function createDataStore(filePath: string): DataRepository {
  return new JsonDataStore(filePath);
}
