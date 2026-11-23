/**
 * Payment reminder routes for Milestone 7.1.
 *
 *   POST /api/reminders/draft      -> 200 { reminder, whatsapp, email, recentSent }   (nothing is saved)
 *   POST /api/reminders/mark-sent  -> 201 { reminder }   (409 if a sent reminder exists within the recent window, unless force)
 *   GET  /api/reminders?invoiceId= -> 200 ReminderRecord[] (date desc, id asc)
 *
 * Every request reloads the dataset. Text and history rules live in core/reminders.ts; this module validates,
 * checks references, saves and responds. Mounted at /api/reminders.
 */

import { randomUUID } from "node:crypto";
import express from "express";
import type { Customer, Dataset, Invoice, ReminderRecord } from "../../../shared/types.js";
import {
  findRecentSentReminder,
  generateReminderText,
  listRemindersForInvoice,
} from "../core/reminders.js";
import { toInvoiceView } from "../core/invoiceStatus.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";
import { draftRequestSchema, markSentRequestSchema } from "../validation/reminderSchemas.js";
import { compareStrings, guard, sendValidationError } from "./crmHelpers.js";

/** Sender name used when the draft request does not supply one. */
const DEFAULT_SENDER_NAME = "Accounts Team";

type ReferenceCheck =
  | { ok: true; invoice: Invoice; customer: Customer; balance: number; daysOverdue: number; dueDate: string }
  | { ok: false; status: number; error: string };

/** Shared reference checks for draft and mark-sent: invoice exists, is not cancelled, has a balance, and has a customer. */
function checkReferences(dataset: Dataset, invoiceId: string): ReferenceCheck {
  const invoice = dataset.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return { ok: false, status: 404, error: "Invoice not found" };

  const view = toInvoiceView(invoice, dataset.payments, dataset.settings.asOfDate);
  if (view.status === "cancelled") return { ok: false, status: 422, error: "Invoice is cancelled" };
  if (view.balance <= 0) return { ok: false, status: 422, error: "Invoice has no outstanding balance" };

  const customer = dataset.customers.find((item) => item.id === invoice.customerId);
  if (!customer) return { ok: false, status: 422, error: "Customer not found" };

  return {
    ok: true,
    invoice,
    customer,
    balance: view.balance,
    daysOverdue: view.daysOverdue,
    dueDate: invoice.dueDate,
  };
}

export function createRemindersRouter(repo: DataRepository): express.Router {
  const router = express.Router();

  router.post(
    "/draft",
    guard((req, res) => {
      const parsed = draftRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      const dataset = loadOrSeedDataset(repo);
      const asOfDate = dataset.settings.asOfDate;
      const check = checkReferences(dataset, input.invoiceId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const text = generateReminderText({
        customerName: check.customer.name,
        invoiceNumber: check.invoice.invoiceNumber,
        balance: check.balance,
        dueDate: check.dueDate,
        daysOverdue: check.daysOverdue,
        tone: input.tone,
        senderName: input.senderName ?? DEFAULT_SENDER_NAME,
      });

      res.json({
        reminder: {
          invoiceId: check.invoice.id,
          customerId: check.customer.id,
          tone: input.tone,
          date: asOfDate,
          balance: check.balance,
        },
        whatsapp: text.whatsapp,
        email: text.email,
        recentSent: findRecentSentReminder(dataset.reminders, check.invoice.id, asOfDate) ?? null,
      });
    }),
  );

  router.post(
    "/mark-sent",
    guard((req, res) => {
      const parsed = markSentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      const input = parsed.data;

      const dataset = loadOrSeedDataset(repo);
      const asOfDate = dataset.settings.asOfDate;
      const check = checkReferences(dataset, input.invoiceId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const recent = findRecentSentReminder(dataset.reminders, check.invoice.id, asOfDate);
      if (recent && input.force !== true) {
        res.status(409).json({
          error: `A reminder was already marked sent for this invoice on ${recent.date}. Resend with force to record another.`,
          existing: recent,
        });
        return;
      }

      const reminder: ReminderRecord = {
        id: `rem-${randomUUID().slice(0, 8)}`,
        invoiceId: check.invoice.id,
        customerId: check.customer.id,
        tone: input.tone,
        date: asOfDate,
        balanceAtDraft: check.balance,
        status: "sent",
        sentAt: asOfDate,
        channels: input.channels,
        isDemoData: false,
      };
      repo.save({ ...dataset, reminders: [...(dataset.reminders ?? []), reminder] });

      res.status(201).json({ reminder });
    }),
  );

  router.get(
    "/",
    guard((req, res) => {
      const raw = req.query.invoiceId;
      if (raw !== undefined && typeof raw !== "string") {
        res.status(400).json({ error: "Query parameter invoiceId must be a single value" });
        return;
      }
      const invoiceId = raw === undefined || raw === "" ? undefined : raw;

      const dataset = loadOrSeedDataset(repo);
      if (invoiceId !== undefined) {
        if (!dataset.invoices.some((invoice) => invoice.id === invoiceId)) {
          res.status(404).json({ error: "Invoice not found" });
          return;
        }
        res.json(listRemindersForInvoice(dataset.reminders, invoiceId));
        return;
      }

      const all = [...(dataset.reminders ?? [])].sort(
        (a, b) => compareStrings(b.date, a.date) || compareStrings(a.id, b.id),
      );
      res.json(all);
    }),
  );

  return router;
}
