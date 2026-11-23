/**
 * Payment reminder generation and reminder history helpers for Milestone 7.1. Pure functions, no I/O, no Date.now.
 *
 * Templates are deterministic and use only the supplied facts: no payment links, bank details, UPI IDs or phone numbers.
 * Money is integer paise (formatted with formatRupees). Dates are "YYYY-MM-DD".
 */

import type { ReminderRecord, ReminderTone } from "../../../shared/types.js";
import { formatDateLabel, formatRupees } from "../ai/facts.js";
import { compareIso, diffDays } from "./dates.js";

/** A sent reminder counts as "recent" for this many days before the as-of date. */
export const RECENT_REMINDER_DAYS = 7;

export interface ReminderTextInput {
  customerName: string;
  invoiceNumber: string;
  /** Open balance in paise (not the invoice total), so partial payments are reflected. */
  balance: number;
  dueDate: string;
  daysOverdue: number;
  tone: ReminderTone;
  senderName: string;
}

export interface ReminderText {
  whatsapp: string;
  email: { subject: string; body: string };
}

function dayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Greeting and body for one tone. The body is a single paragraph with no links. */
function buildParts(input: ReminderTextInput, amount: string, due: string): { greeting: string; body: string; subject: string } {
  const no = input.invoiceNumber;
  const overdue = input.daysOverdue > 0;

  if (input.tone === "friendly") {
    return {
      greeting: `Hi ${input.customerName},`,
      body:
        `This is a quick reminder that invoice ${no} for ${amount} was due on ${due}. ` +
        `Could you let us know when we can expect payment? Thank you.`,
      subject: `Reminder: invoice ${no}`,
    };
  }

  if (input.tone === "professional") {
    const pastDue = overdue ? ` and is now ${dayCount(input.daysOverdue)} past due` : "";
    return {
      greeting: `Dear ${input.customerName},`,
      body:
        `Our records show invoice ${no} for ${amount}, due on ${due}, is outstanding${pastDue}. ` +
        `Please arrange payment at your earliest convenience and reply to confirm the expected date.`,
      subject: `Payment reminder: invoice ${no}`,
    };
  }

  const after = overdue ? ` ${dayCount(input.daysOverdue)} after the due date` : "";
  return {
    greeting: `Dear ${input.customerName},`,
    body:
      `Invoice ${no} for ${amount}, due on ${due}, remains unpaid${after}. ` +
      `Please settle the outstanding balance within 7 days of this message. ` +
      `If payment is not received, we will need to review the account terms.`,
    subject: `Urgent: outstanding invoice ${no}`,
  };
}

export function generateReminderText(input: ReminderTextInput): ReminderText {
  if (input.balance <= 0) {
    throw new Error("Invoice has no outstanding balance");
  }

  const amount = formatRupees(input.balance);
  const due = formatDateLabel(input.dueDate);
  const parts = buildParts(input, amount, due);

  return {
    whatsapp: `${parts.greeting}\n${parts.body}`,
    email: {
      subject: parts.subject,
      body: `${parts.greeting}\n\n${parts.body}\n\nRegards,\n${input.senderName}`,
    },
  };
}

/**
 * Most recent "sent" reminder for the invoice whose date is 0..RECENT_REMINDER_DAYS days before asOfDate.
 * Returns undefined when there is none.
 */
export function findRecentSentReminder(
  reminders: ReminderRecord[] | undefined,
  invoiceId: string,
  asOfDate: string,
): ReminderRecord | undefined {
  const recent = (reminders ?? []).filter((reminder) => {
    if (reminder.invoiceId !== invoiceId || reminder.status !== "sent") return false;
    const age = diffDays(reminder.date, asOfDate);
    return age >= 0 && age <= RECENT_REMINDER_DAYS;
  });
  return sortReminders(recent)[0];
}

/** Reminders for one invoice, sorted by date descending then id ascending. */
export function listRemindersForInvoice(
  reminders: ReminderRecord[] | undefined,
  invoiceId: string,
): ReminderRecord[] {
  return sortReminders((reminders ?? []).filter((reminder) => reminder.invoiceId === invoiceId));
}

function sortReminders(list: ReminderRecord[]): ReminderRecord[] {
  return [...list].sort((a, b) => compareIso(b.date, a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
