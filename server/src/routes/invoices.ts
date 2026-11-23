/**
 * Invoice and payment routes for Milestone 3.
 *
 *   GET    /api/invoices                    -> InvoiceView[] (filters: status, customerId, search)
 *   GET    /api/invoices/:id                -> InvoiceView
 *   POST   /api/invoices                    -> 201 InvoiceView
 *   PUT    /api/invoices/:id                -> InvoiceView
 *   DELETE /api/invoices/:id                -> 204 (also removes the invoice's payments)
 *   POST   /api/invoices/:id/payments       -> 201 InvoiceView
 *   GET    /api/invoices/:id/payments       -> Payment[]
 *
 * Every mutation reloads the dataset, validates, builds new arrays, re-derives every invoice's
 * stored status from its payments, and saves via the store. Nothing is written if validation fails.
 */

import type express from "express";
import { ZodError, z } from "zod";
import type { Invoice, InvoiceStatus, Payment } from "../../../shared/types.js";
import { deriveInvoiceStatus, paidAmountFor, toInvoiceView } from "../core/invoiceStatus.js";
import { compareIso } from "../core/dates.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";
import { invoiceInputSchema, invoiceUpdateSchema, paymentInputSchema } from "../validation/crmSchemas.js";
import { compareStrings, guard, newId, sendValidationError } from "./crmHelpers.js";

const INVOICE_STATUSES: readonly InvoiceStatus[] = ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"];

/** Return a copy of the invoices with status set to the value derived from the current payments. */
function syncInvoiceStatuses(invoices: Invoice[], payments: Payment[], asOfDate: string): Invoice[] {
  return invoices.map((invoice) => ({
    ...invoice,
    status: deriveInvoiceStatus(invoice, paidAmountFor(invoice.id, payments), asOfDate),
  }));
}

/** Read an optional query-string parameter; returns undefined when absent or empty, null when repeated/non-string. */
function readQuery(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return value === "" ? undefined : value;
}

export function registerInvoiceRoutes(app: express.Express, repo: DataRepository): void {
  app.get(
    "/api/invoices",
    guard((req, res) => {
      const status = readQuery(req.query.status);
      const customerId = readQuery(req.query.customerId);
      const search = readQuery(req.query.search);
      if (status === null || customerId === null || search === null) {
        res.status(400).json({ error: "Query parameters status, customerId and search must each be a single value" });
        return;
      }
      if (status !== undefined && !INVOICE_STATUSES.includes(status as InvoiceStatus)) {
        res.status(400).json({ error: `status must be one of: ${INVOICE_STATUSES.join(", ")}` });
        return;
      }

      const dataset = loadOrSeedDataset(repo);
      const asOfDate = dataset.settings.asOfDate;
      const customerNames = new Map(dataset.customers.map((customer) => [customer.id, customer.name]));
      const needle = search?.trim().toLowerCase();

      const views = dataset.invoices
        .map((invoice) => toInvoiceView(invoice, dataset.payments, asOfDate))
        .filter((view) => status === undefined || view.status === status)
        .filter((view) => customerId === undefined || view.customerId === customerId)
        .filter((view) => {
          if (!needle) return true;
          const customerName = customerNames.get(view.customerId) ?? "";
          return view.invoiceNumber.toLowerCase().includes(needle) || customerName.toLowerCase().includes(needle);
        })
        .sort((a, b) => compareStrings(a.dueDate, b.dueDate) || compareStrings(a.invoiceNumber, b.invoiceNumber));

      res.json(views);
    }),
  );

  app.get(
    "/api/invoices/:id",
    guard((req, res) => {
      const id = req.params.id as string;
      const dataset = loadOrSeedDataset(repo);
      const invoice = dataset.invoices.find((item) => item.id === id);
      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      res.json(toInvoiceView(invoice, dataset.payments, dataset.settings.asOfDate));
    }),
  );

  app.post(
    "/api/invoices",
    guard((req, res) => {
      const parsed = invoiceInputSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      const dataset = loadOrSeedDataset(repo);
      const asOfDate = dataset.settings.asOfDate;

      if (!dataset.customers.some((customer) => customer.id === input.customerId)) {
        res.status(422).json({ error: "Customer not found" });
        return;
      }
      if (dataset.invoices.some((invoice) => invoice.invoiceNumber === input.invoiceNumber)) {
        res.status(409).json({ error: "Invoice number already exists" });
        return;
      }

      // Placeholder status; syncInvoiceStatuses derives the real value below.
      const invoice: Invoice = {
        id: newId("inv"),
        invoiceNumber: input.invoiceNumber,
        customerId: input.customerId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        amount: input.amount,
        status: "sent",
      };
      if (input.notes !== undefined) invoice.notes = input.notes;
      if (input.cancelled !== undefined) invoice.cancelled = input.cancelled;

      const invoices = syncInvoiceStatuses([...dataset.invoices, invoice], dataset.payments, asOfDate);
      repo.save({ ...dataset, invoices });

      const saved = invoices.find((item) => item.id === invoice.id) ?? invoice;
      res.status(201).json(toInvoiceView(saved, dataset.payments, asOfDate));
    }),
  );

  app.put(
    "/api/invoices/:id",
    guard((req, res) => {
      const id = req.params.id as string;
      const parsed = invoiceUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      const dataset = loadOrSeedDataset(repo);
      const asOfDate = dataset.settings.asOfDate;
      const existing = dataset.invoices.find((invoice) => invoice.id === id);
      if (!existing) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      if (
        input.customerId !== undefined &&
        input.customerId !== existing.customerId &&
        !dataset.customers.some((customer) => customer.id === input.customerId)
      ) {
        res.status(422).json({ error: "Customer not found" });
        return;
      }
      if (
        input.invoiceNumber !== undefined &&
        input.invoiceNumber !== existing.invoiceNumber &&
        dataset.invoices.some((invoice) => invoice.id !== id && invoice.invoiceNumber === input.invoiceNumber)
      ) {
        res.status(409).json({ error: "Invoice number already exists" });
        return;
      }

      const paidAmount = paidAmountFor(id, dataset.payments);
      if (input.amount !== undefined && input.amount < paidAmount) {
        res.status(422).json({ error: "Amount cannot be less than the amount already paid" });
        return;
      }

      // The schema only checks the date pair when both are sent; re-check against the merged values.
      const issueDate = input.issueDate ?? existing.issueDate;
      const dueDate = input.dueDate ?? existing.dueDate;
      if (compareIso(dueDate, issueDate) < 0) {
        sendValidationError(
          res,
          new ZodError([
            {
              code: z.ZodIssueCode.custom,
              path: ["dueDate"],
              message: "Due date must be on or after the issue date",
            },
          ]),
        );
        return;
      }

      const updated: Invoice = { ...existing, issueDate, dueDate };
      if (input.invoiceNumber !== undefined) updated.invoiceNumber = input.invoiceNumber;
      if (input.customerId !== undefined) updated.customerId = input.customerId;
      if (input.amount !== undefined) updated.amount = input.amount;
      if (input.notes !== undefined) updated.notes = input.notes;
      if (input.cancelled !== undefined) updated.cancelled = input.cancelled;
      // Status is re-derived. Reset the stored value first so a previous "cancelled" does not survive un-cancelling.
      updated.status = "sent";

      const invoices = syncInvoiceStatuses(
        dataset.invoices.map((invoice) => (invoice.id === id ? updated : invoice)),
        dataset.payments,
        asOfDate,
      );
      repo.save({ ...dataset, invoices });

      const saved = invoices.find((invoice) => invoice.id === id) ?? updated;
      res.json(toInvoiceView(saved, dataset.payments, asOfDate));
    }),
  );

  app.delete(
    "/api/invoices/:id",
    guard((req, res) => {
      const id = req.params.id as string;
      const dataset = loadOrSeedDataset(repo);
      if (!dataset.invoices.some((invoice) => invoice.id === id)) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      const invoices = syncInvoiceStatuses(
        dataset.invoices.filter((invoice) => invoice.id !== id),
        dataset.payments.filter((payment) => payment.invoiceId !== id),
        dataset.settings.asOfDate,
      );
      repo.save({
        ...dataset,
        invoices,
        payments: dataset.payments.filter((payment) => payment.invoiceId !== id),
      });
      res.status(204).end();
    }),
  );

  app.post(
    "/api/invoices/:id/payments",
    guard((req, res) => {
      const id = req.params.id as string;
      const parsed = paymentInputSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      const dataset = loadOrSeedDataset(repo);
      const asOfDate = dataset.settings.asOfDate;
      const invoice = dataset.invoices.find((item) => item.id === id);
      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      const current = toInvoiceView(invoice, dataset.payments, asOfDate);
      if (current.status === "cancelled") {
        res.status(422).json({ error: "Invoice is cancelled" });
        return;
      }
      if (compareIso(input.date, asOfDate) > 0) {
        res.status(422).json({ error: `Payment date must be on or before the as-of date ${asOfDate}` });
        return;
      }
      // Checked before the over-payment rule: with a zero balance every amount would otherwise read as "exceeds 0".
      if (current.balance === 0) {
        res.status(422).json({ error: "Invoice is already fully paid" });
        return;
      }
      if (input.amount > current.balance) {
        res.status(422).json({ error: `Payment exceeds outstanding balance of ${current.balance}` });
        return;
      }

      const payment: Payment = {
        id: newId("pay"),
        invoiceId: id,
        date: input.date,
        amount: input.amount,
        isDemoData: false,
      };
      const payments = [...dataset.payments, payment];
      const invoices = syncInvoiceStatuses(dataset.invoices, payments, asOfDate);
      repo.save({ ...dataset, invoices, payments });

      const saved = invoices.find((item) => item.id === id) ?? invoice;
      res.status(201).json(toInvoiceView(saved, payments, asOfDate));
    }),
  );

  app.get(
    "/api/invoices/:id/payments",
    guard((req, res) => {
      const id = req.params.id as string;
      const dataset = loadOrSeedDataset(repo);
      if (!dataset.invoices.some((invoice) => invoice.id === id)) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      const payments = dataset.payments
        .filter((payment) => payment.invoiceId === id)
        .sort((a, b) => compareIso(a.date, b.date) || compareStrings(a.id, b.id));
      res.json(payments);
    }),
  );
}
