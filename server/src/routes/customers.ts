/**
 * Customer CRUD routes for Milestone 3.
 *
 *   GET    /api/customers           -> CustomerView[]
 *   GET    /api/customers/:id       -> CustomerView
 *   POST   /api/customers           -> 201 Customer
 *   PUT    /api/customers/:id       -> Customer
 *   DELETE /api/customers/:id       -> 204 (409 if the customer has any invoices)
 *
 * Every mutation reloads the dataset, validates, builds new arrays and saves via the store.
 */

import type express from "express";
import type { Customer, CustomerView, Dataset } from "../../../shared/types.js";
import { toInvoiceView } from "../core/invoiceStatus.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";
import { customerInputSchema, customerUpdateSchema } from "../validation/crmSchemas.js";
import { compareStrings, guard, newId, sendValidationError } from "./crmHelpers.js";

/** Build CustomerView rows: non-cancelled invoice count, outstanding balance, and overdue balance. */
export function buildCustomerViews(dataset: Dataset): CustomerView[] {
  const asOfDate = dataset.settings.asOfDate;
  const stats = new Map<string, { invoiceCount: number; outstanding: number; overdueAmount: number }>();

  for (const invoice of dataset.invoices) {
    const view = toInvoiceView(invoice, dataset.payments, asOfDate);
    if (view.status === "cancelled") continue;

    const entry = stats.get(invoice.customerId) ?? { invoiceCount: 0, outstanding: 0, overdueAmount: 0 };
    entry.invoiceCount += 1;
    entry.outstanding += view.balance;
    if (view.daysOverdue > 0) entry.overdueAmount += view.balance;
    stats.set(invoice.customerId, entry);
  }

  return dataset.customers
    .map((customer) => {
      const entry = stats.get(customer.id);
      return {
        ...customer,
        invoiceCount: entry?.invoiceCount ?? 0,
        outstanding: entry?.outstanding ?? 0,
        overdueAmount: entry?.overdueAmount ?? 0,
      };
    })
    .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id));
}

export function registerCustomerRoutes(app: express.Express, repo: DataRepository): void {
  app.get(
    "/api/customers",
    guard((_req, res) => {
      const dataset = loadOrSeedDataset(repo);
      res.json(buildCustomerViews(dataset));
    }),
  );

  app.get(
    "/api/customers/:id",
    guard((req, res) => {
      const id = req.params.id as string;
      const dataset = loadOrSeedDataset(repo);
      const view = buildCustomerViews(dataset).find((customer) => customer.id === id);
      if (!view) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }
      res.json(view);
    }),
  );

  app.post(
    "/api/customers",
    guard((req, res) => {
      const parsed = customerInputSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      // Optional keys are added only when they have a value, so no key is ever set to undefined.
      const customer: Customer = { id: newId("cust"), name: input.name, isDemoData: false };
      if (input.email !== undefined) customer.email = input.email;
      if (input.phone !== undefined) customer.phone = input.phone;

      const dataset = loadOrSeedDataset(repo);
      repo.save({ ...dataset, customers: [...dataset.customers, customer] });
      res.status(201).json(customer);
    }),
  );

  app.put(
    "/api/customers/:id",
    guard((req, res) => {
      const id = req.params.id as string;
      const parsed = customerUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      const dataset = loadOrSeedDataset(repo);
      const existing = dataset.customers.find((customer) => customer.id === id);
      if (!existing) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      if (Object.keys(input).length === 0) {
        res.status(400).json({ error: "Update body must include at least one field" });
        return;
      }

      const updated: Customer = { ...existing };
      if (input.name !== undefined) updated.name = input.name;
      // An empty string in the body clears the field: the schema turns it into an undefined key, which we remove.
      if ("email" in input) {
        if (input.email === undefined) delete updated.email;
        else updated.email = input.email;
      }
      if ("phone" in input) {
        if (input.phone === undefined) delete updated.phone;
        else updated.phone = input.phone;
      }

      const customers = dataset.customers.map((customer) => (customer.id === id ? updated : customer));
      repo.save({ ...dataset, customers });
      res.json(updated);
    }),
  );

  app.delete(
    "/api/customers/:id",
    guard((req, res) => {
      const id = req.params.id as string;
      const dataset = loadOrSeedDataset(repo);
      if (!dataset.customers.some((customer) => customer.id === id)) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }
      if (dataset.invoices.some((invoice) => invoice.customerId === id)) {
        res.status(409).json({ error: "Customer has invoices; delete or reassign them first" });
        return;
      }

      const customers = dataset.customers.filter((customer) => customer.id !== id);
      repo.save({ ...dataset, customers });
      res.status(204).end();
    }),
  );
}
