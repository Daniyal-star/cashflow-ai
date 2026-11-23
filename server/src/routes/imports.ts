
import express from "express";
import type { Customer, Invoice } from "../../../shared/types.js";
import { deriveInvoiceStatus, paidAmountFor } from "../core/invoiceStatus.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";
import { customerInputSchema, invoiceInputSchema } from "../validation/crmSchemas.js";
import { guard, newId } from "./crmHelpers.js";

type ImportType = "customers" | "invoices";

interface CsvRecord {
  line: number;
  values: string[];
}

interface PreparedImport {
  customers: Customer[];
  invoices: Invoice[];
  issues: Array<{ line: number; message: string }>;
  validRows: Array<Record<string, string>>;
}

const MAX_ROWS = 2000;

function parseCsv(source: string): { headers: string[]; records: CsvRecord[] } {
  const input = source.replace(/^\uFEFF/, "");
  const rows: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      fields.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      fields.push(field.trim());
      field = "";
      if (fields.some((value) => value !== "")) {
        rows.push({ line: rowLine, values: fields });
      }
      fields = [];
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      line += 1;
      rowLine = line;
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field.");

  fields.push(field.trim());
  if (fields.some((value) => value !== "")) {
    rows.push({ line: rowLine, values: fields });
  }

  if (rows.length === 0) throw new Error("CSV is empty.");
  if (rows.length - 1 > MAX_ROWS) {
    throw new Error(`CSV cannot contain more than ${MAX_ROWS} data rows.`);
  }

  const headers = rows[0].values.map((header) => header.trim().toLowerCase());

  if (headers.some((header) => !header)) {
    throw new Error("CSV contains an empty column heading.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV contains duplicate column headings.");
  }

  return { headers, records: rows.slice(1) };
}

function amountToPaise(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;

  const [rupees, fraction = ""] = cleaned.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

function normaliseName(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function prepareImport(
  type: ImportType,
  csv: string,
  dataset: ReturnType<typeof loadOrSeedDataset>,
): PreparedImport {
  const parsed = parseCsv(csv);

  const required =
    type === "customers"
      ? ["name"]
      : ["invoicenumber", "customername", "issuedate", "duedate", "amount"];

  const missing = required.filter((header) => !parsed.headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Missing CSV columns: ${missing.join(", ")}`);
  }

  const customers: Customer[] = [];
  const invoices: Invoice[] = [];
  const issues: PreparedImport["issues"] = [];
  const validRows: Array<Record<string, string>> = [];

  const customerNames = new Set(
    dataset.customers.map((customer) => normaliseName(customer.name)),
  );
  const invoiceNumbers = new Set(
    dataset.invoices.map((invoice) => invoice.invoiceNumber.trim().toLowerCase()),
  );
  const customerByName = new Map(
    dataset.customers.map((customer) => [normaliseName(customer.name), customer]),
  );

  for (const record of parsed.records) {
    if (record.values.length !== parsed.headers.length) {
      issues.push({
        line: record.line,
        message: `Expected ${parsed.headers.length} columns but found ${record.values.length}.`,
      });
      continue;
    }

    const row = Object.fromEntries(
      parsed.headers.map((header, index) => [header, record.values[index]]),
    ) as Record<string, string>;

    if (type === "customers") {
      const result = customerInputSchema.safeParse({
        name: row.name,
        email: row.email,
        phone: row.phone,
      });

      if (!result.success) {
        issues.push({
          line: record.line,
          message: result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });
        continue;
      }

      const key = normaliseName(result.data.name);
      if (customerNames.has(key)) {
        issues.push({
          line: record.line,
          message: `Customer "${result.data.name}" already exists or is duplicated in this CSV.`,
        });
        continue;
      }

      customerNames.add(key);

      const customer: Customer = {
        id: newId("cust"),
        name: result.data.name,
        isDemoData: false,
      };
      if (result.data.email !== undefined) customer.email = result.data.email;
      if (result.data.phone !== undefined) customer.phone = result.data.phone;

      customers.push(customer);
      validRows.push({
        name: customer.name,
        email: customer.email ?? "",
        phone: customer.phone ?? "",
      });
      continue;
    }

    const amount = amountToPaise(row.amount);
    if (amount === null) {
      issues.push({
        line: record.line,
        message: "Amount must be a positive rupee value with no more than 2 decimal places.",
      });
      continue;
    }

    const customer = customerByName.get(normaliseName(row.customername));
    if (!customer) {
      issues.push({
        line: record.line,
        message: `Customer "${row.customername}" was not found. Import that customer first.`,
      });
      continue;
    }

    const invoiceNumber = row.invoicenumber.trim();
    const numberKey = invoiceNumber.toLowerCase();

    if (invoiceNumbers.has(numberKey)) {
      issues.push({
        line: record.line,
        message: `Invoice number "${invoiceNumber}" already exists or is duplicated in this CSV.`,
      });
      continue;
    }

    const result = invoiceInputSchema.safeParse({
      invoiceNumber,
      customerId: customer.id,
      issueDate: row.issuedate,
      dueDate: row.duedate,
      amount,
    });

    if (!result.success) {
      issues.push({
        line: record.line,
        message: result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    invoiceNumbers.add(numberKey);

    const invoice: Invoice = {
      id: newId("inv"),
      invoiceNumber: result.data.invoiceNumber,
      customerId: result.data.customerId,
      issueDate: result.data.issueDate,
      dueDate: result.data.dueDate,
      amount: result.data.amount,
      status: "sent",
    };

    invoices.push(invoice);
    validRows.push({
      invoiceNumber: invoice.invoiceNumber,
      customerName: customer.name,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      amount: row.amount,
    });
  }

  return { customers, invoices, issues, validRows };
}

function readImportRequest(
  body: unknown,
): { type: ImportType; csv: string } | null {
  if (!body || typeof body !== "object") return null;

  const value = body as Record<string, unknown>;
  if (
    (value.type !== "customers" && value.type !== "invoices") ||
    typeof value.csv !== "string" ||
    value.csv.trim() === ""
  ) {
    return null;
  }

  return { type: value.type, csv: value.csv };
}

export function createImportRouter(repo: DataRepository): express.Router {
  const router = express.Router();

  router.post(
    "/preview",
    guard((req, res) => {
      const request = readImportRequest(req.body);
      if (!request) {
        res.status(400).json({
          error: 'Provide type ("customers" or "invoices") and a non-empty csv string.',
        });
        return;
      }

      const dataset = loadOrSeedDataset(repo);
      const prepared = prepareImport(request.type, request.csv, dataset);

      res.json({
        type: request.type,
        totalRows: prepared.validRows.length + prepared.issues.length,
        validCount: prepared.validRows.length,
        invalidCount: prepared.issues.length,
        validRows: prepared.validRows,
        issues: prepared.issues,
      });
    }),
  );

  router.post(
    "/confirm",
    guard((req, res) => {
      const request = readImportRequest(req.body);
      if (!request) {
        res.status(400).json({
          error: 'Provide type ("customers" or "invoices") and a non-empty csv string.',
        });
        return;
      }

      const dataset = loadOrSeedDataset(repo);
      const prepared = prepareImport(request.type, request.csv, dataset);

      if (prepared.validRows.length === 0) {
        res.status(400).json({
          error: "There are no valid rows to import.",
          issues: prepared.issues,
        });
        return;
      }

      if (request.type === "customers") {
        repo.save({
          ...dataset,
          customers: [...dataset.customers, ...prepared.customers],
        });

        res.status(201).json({
          type: request.type,
          importedCount: prepared.customers.length,
          skippedCount: prepared.issues.length,
          issues: prepared.issues,
        });
        return;
      }

      const newInvoices = [...dataset.invoices, ...prepared.invoices].map((invoice) => ({
        ...invoice,
        status: deriveInvoiceStatus(
          invoice,
          paidAmountFor(invoice.id, dataset.payments),
          dataset.settings.asOfDate,
        ),
      }));

      repo.save({ ...dataset, invoices: newInvoices });

      res.status(201).json({
        type: request.type,
        importedCount: prepared.invoices.length,
        skippedCount: prepared.issues.length,
        issues: prepared.issues,
      });
    }),
  );

  return router;
}
