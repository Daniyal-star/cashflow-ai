/**
 * Deterministic daily cash-flow engine for CASHFLOW AI.
 *
 * No randomness, no Date.now(), no LLM. All money is integer paise.
 * Output depends only on the inputs and the order of the arrays given.
 */

import type {
  Dataset,
  Expense,
  ForecastDay,
  ForecastResult,
  Invoice,
  Payment,
  RiskLevel,
  ScenarioAdjustment,
} from "../../../shared/types.js";
import { addDays, addMonthsClamped, compareIso, diffDays, isValidIsoDate } from "./dates.js";

export interface ForecastOptions {
  adjustments?: ScenarioAdjustment[];
}

const DEFAULT_HORIZON_DAYS = 30;

/** An open receivable that is still expected to be collected. */
interface OpenReceivable {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  dueDate: string;
  remaining: number;
  expected: string;
}

/** Lump-sum incoming created by a customer_partial_payment adjustment. */
interface FixedIncoming {
  date: string;
  amount: number;
}

/**
 * Original (un-postponed) occurrence dates of a weekly/monthly expense, generated from its dueDate,
 * up to horizonEnd and recurrenceEndDate (when valid). Pure: emits no warnings.
 */
function seriesOccurrences(expense: Expense, horizonEnd: string): string[] {
  const endDate =
    expense.recurrenceEndDate !== undefined && isValidIsoDate(expense.recurrenceEndDate)
      ? expense.recurrenceEndDate
      : null;
  const dates: string[] = [];
  for (let k = 0; ; k++) {
    const occurrence =
      expense.recurrence === "weekly" ? addDays(expense.dueDate, 7 * k) : addMonthsClamped(expense.dueDate, k);
    if (compareIso(occurrence, horizonEnd) > 0) break;
    if (endDate !== null && compareIso(occurrence, endDate) > 0) break;
    dates.push(occurrence);
  }
  return dates;
}

export function forecastCashFlow(dataset: Dataset, options?: ForecastOptions): ForecastResult {
  const settings = dataset.settings;
  const asOf = settings.asOfDate;
  if (!isValidIsoDate(asOf)) {
    throw new Error("Invalid asOfDate");
  }

  const horizonDays =
    Number.isInteger(settings.forecastHorizonDays) && settings.forecastHorizonDays > 0
      ? settings.forecastHorizonDays
      : DEFAULT_HORIZON_DAYS;
  const horizonEnd = addDays(asOf, horizonDays);
  const openingBalance = settings.openingBalance;
  const safetyBuffer = settings.safetyBuffer;
  const defaultDelayDays = settings.defaultPaymentDelayDays;
  const overdueDelayDays = settings.overdueCollectionDelayDays;

  const customers = dataset.customers ?? [];
  const invoices = dataset.invoices ?? [];
  const payments = dataset.payments ?? [];
  const expenses = dataset.expenses ?? [];
  const adjustments = options?.adjustments ?? [];

  const customerIds = new Set<string>(customers.map((c) => c.id));
  const warnings: string[] = [];
  const assumptions: string[] = [];

  // Per-day buckets, index 0 = asOf+1 ... index horizonDays-1 = asOf+horizonDays.
  const incoming: number[] = new Array<number>(horizonDays).fill(0);
  const outgoing: number[] = new Array<number>(horizonDays).fill(0);

  const isInHorizon = (date: string): boolean =>
    isValidIsoDate(date) && compareIso(date, asOf) > 0 && compareIso(date, horizonEnd) <= 0;
  const dayIndex = (date: string): number => diffDays(asOf, date) - 1;
  const clampExpected = (date: string): string =>
    compareIso(date, asOf) <= 0 ? addDays(asOf, 1) : date;

  // ---- Paid-to-date per invoice (payments dated on or before asOf only) ----
  const paidByInvoice = new Map<string, number>();
  for (const payment of payments as Payment[]) {
    if (!isValidIsoDate(payment.date)) {
      warnings.push(`Payment ${payment.id} ignored: invalid date`);
      continue;
    }
    if (!(payment.amount > 0)) {
      warnings.push(`Payment ${payment.id} ignored: amount must be greater than 0`);
      continue;
    }
    if (compareIso(payment.date, asOf) > 0) {
      // Future-dated: not yet received, so not counted as paid.
      continue;
    }
    paidByInvoice.set(payment.invoiceId, (paidByInvoice.get(payment.invoiceId) ?? 0) + payment.amount);
  }

  // ---- Base receivables ----
  let receivables: OpenReceivable[] = [];
  for (const invoice of invoices as Invoice[]) {
    if (invoice.status === "cancelled" || invoice.cancelled === true) {
      continue;
    }
    if (!isValidIsoDate(invoice.dueDate)) {
      warnings.push(`Invoice ${invoice.invoiceNumber} skipped: invalid dueDate`);
      continue;
    }
    const paid = paidByInvoice.get(invoice.id) ?? 0;
    const remaining = Math.max(0, invoice.amount - paid);
    if (remaining === 0) {
      continue;
    }
    const expected =
      compareIso(invoice.dueDate, asOf) >= 0
        ? addDays(invoice.dueDate, defaultDelayDays)
        : addDays(asOf, overdueDelayDays);
    receivables.push({
      invoiceId: invoice.id,
      dueDate: invoice.dueDate,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      remaining,
      expected: clampExpected(expected),
    });
  }

  // ---- Working copies of expenses (scenario adjustments never touch the dataset) ----
  const workingExpenses: Expense[] = (expenses as Expense[]).map((expense) => ({ ...expense }));
  const fixedIncoming: FixedIncoming[] = [];
  // expenseId -> (original occurrence date -> postponed date). Only selected occurrences appear here.
  const occurrenceShifts = new Map<string, Map<string, string>>();
  let scenarioExpenseSeq = 0;

  const findWorkingExpense = (expenseId: string): Expense | undefined =>
    workingExpenses.find((expense) => expense.id === expenseId);

  // ---- Scenario adjustments, applied in order ----
  for (const adjustment of adjustments) {
    switch (adjustment.type) {
      case "customer_delay":
      case "customer_early_payment": {
        const { customerId } = adjustment;
        if (!customerIds.has(customerId)) {
          warnings.push(`Scenario ${adjustment.type} ignored: unknown customer ${customerId}`);
          break;
        }
        if (!Number.isInteger(adjustment.days)) {
          warnings.push(`Scenario ${adjustment.type} for customer ${customerId} ignored: days must be an integer`);
          break;
        }
        const shift = adjustment.type === "customer_delay" ? adjustment.days : -adjustment.days;
        receivables = receivables.map((receivable) =>
          receivable.customerId === customerId
            ? { ...receivable, expected: clampExpected(addDays(receivable.expected, shift)) }
            : receivable,
        );
        assumptions.push(
          adjustment.type === "customer_delay"
            ? `Scenario: customer ${customerId} collections delayed by ${adjustment.days} day(s)`
            : `Scenario: customer ${customerId} collections brought forward by ${adjustment.days} day(s)`,
        );
        break;
      }
      case "customer_partial_payment": {
        const { customerId, expectedDate, amount } = adjustment;
        if (!customerIds.has(customerId)) {
          warnings.push(`Scenario customer_partial_payment ignored: unknown customer ${customerId}`);
          break;
        }
        if (!(amount > 0)) {
          warnings.push(`Scenario customer_partial_payment for customer ${customerId} ignored: amount must be greater than 0`);
          break;
        }
        if (!isInHorizon(expectedDate)) {
          warnings.push(
            `Scenario partial payment for customer ${customerId} not added: expectedDate ${String(expectedDate)} is invalid or outside the forecast horizon`,
          );
          break;
        }
        // Oldest-due-first: invoice dueDate asc, then invoice id asc.
        const ownReceivables = receivables
          .filter((receivable) => receivable.customerId === customerId)
          .sort((a, b) => {
            if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
            if (a.invoiceId !== b.invoiceId) return a.invoiceId < b.invoiceId ? -1 : 1;
            return 0;
          });
        const takeByInvoice = new Map<string, number>();
        let budget = amount;
        let collected = 0;
        for (const receivable of ownReceivables) {
          const take = Math.min(budget, receivable.remaining);
          if (take <= 0) break;
          takeByInvoice.set(receivable.invoiceId, take);
          budget -= take;
          collected += take;
        }
        // Applied portions are collected on expectedDate; uncovered remainders keep their normal expected date.
        receivables = receivables.flatMap((receivable) => {
          const take = takeByInvoice.get(receivable.invoiceId);
          if (take === undefined) return [receivable];
          const left = receivable.remaining - take;
          return left > 0 ? [{ ...receivable, remaining: left }] : [];
        });
        if (collected > 0) {
          fixedIncoming.push({ date: expectedDate, amount: collected });
        }
        assumptions.push(
          `Scenario: customer ${customerId} paid ${amount} paise on ${expectedDate}, applied oldest-due-first to open receivables; ${collected} paise collected on ${expectedDate}, any remainder stays on its normal expected date`,
        );
        break;
      }
      case "new_expense": {
        if (!isValidIsoDate(adjustment.date)) {
          warnings.push(`Scenario new expense ${adjustment.name} skipped: invalid date`);
          break;
        }
        scenarioExpenseSeq += 1;
        workingExpenses.push({
          id: `scenario-expense-${scenarioExpenseSeq}`,
          name: adjustment.name,
          category: "scenario",
          amount: adjustment.amount,
          dueDate: adjustment.date,
          recurrence: adjustment.recurrence,
          isDemoData: false,
        });
        assumptions.push(
          `Scenario: new ${adjustment.recurrence} expense ${adjustment.name} of ${adjustment.amount} paise starting ${adjustment.date}`,
        );
        break;
      }
      case "expense_increase":
      case "rent_increase": {
        const expense = findWorkingExpense(adjustment.expenseId);
        if (!expense) {
          warnings.push(`Scenario ${adjustment.type} ignored: unknown expense ${adjustment.expenseId}`);
          break;
        }
        expense.amount = Math.round((expense.amount * (100 + adjustment.percent)) / 100);
        assumptions.push(
          `Scenario: ${expense.name} increased by ${adjustment.percent}% to ${expense.amount} paise`,
        );
        break;
      }
      case "expense_postponement": {
        const expense = findWorkingExpense(adjustment.expenseId);
        if (!expense) {
          warnings.push(`Scenario expense_postponement ignored: unknown expense ${adjustment.expenseId}`);
          break;
        }
        if (!Number.isInteger(adjustment.days)) {
          warnings.push(`Scenario expense_postponement for ${expense.name} ignored: days must be an integer`);
          break;
        }
        const { occurrenceDate } = adjustment;
        if (expense.recurrence === "weekly" || expense.recurrence === "monthly") {
          // Only open occurrences (on or after asOf, inside the horizon) can be selected.
          const candidates = seriesOccurrences(expense, horizonEnd).filter((d) => compareIso(d, asOf) >= 0);
          const target = occurrenceDate === undefined ? candidates[0] : candidates.find((d) => d === occurrenceDate);
          if (target === undefined) {
            warnings.push(
              occurrenceDate === undefined
                ? `Scenario expense_postponement for ${expense.name} ignored: no occurrence inside the forecast horizon`
                : `Scenario expense_postponement for ${expense.name} ignored: no generated occurrence on ${String(occurrenceDate)}`,
            );
            break;
          }
          const shifts = occurrenceShifts.get(expense.id) ?? new Map<string, string>();
          occurrenceShifts.set(expense.id, shifts);
          const next = addDays(shifts.get(target) ?? target, adjustment.days);
          shifts.set(target, next);
          if (compareIso(next, asOf) < 0) {
            warnings.push(
              `Scenario expense_postponement for ${expense.name} moved ${target} to ${next}, before the as-of date; treated as settled`,
            );
          }
          assumptions.push(
            occurrenceDate === undefined
              ? `Scenario: first ${expense.recurrence} occurrence of ${expense.name} inside the horizon (${target}) postponed by ${adjustment.days} day(s) to ${next}; other occurrences unchanged`
              : `Scenario: ${expense.name} occurrence on ${target} postponed by ${adjustment.days} day(s) to ${next}; other occurrences unchanged`,
          );
        } else {
          if (occurrenceDate !== undefined && occurrenceDate !== expense.dueDate) {
            warnings.push(
              `Scenario expense_postponement for ${expense.name} ignored: no generated occurrence on ${String(occurrenceDate)}`,
            );
            break;
          }
          if (isValidIsoDate(expense.dueDate)) {
            expense.dueDate = addDays(expense.dueDate, adjustment.days);
            if (compareIso(expense.dueDate, asOf) < 0) {
              warnings.push(
                `Scenario expense_postponement for ${expense.name} moved it to ${expense.dueDate}, before the as-of date; treated as settled`,
              );
            }
          }
          assumptions.push(`Scenario: ${expense.name} postponed by ${adjustment.days} day(s)`);
        }
        break;
      }
      case "supplier_payment_change": {
        const expense = findWorkingExpense(adjustment.expenseId);
        if (!expense) {
          warnings.push(`Scenario supplier_payment_change ignored: unknown expense ${adjustment.expenseId}`);
          break;
        }
        expense.amount = adjustment.amount;
        assumptions.push(`Scenario: ${expense.name} payment changed to ${adjustment.amount} paise`);
        break;
      }
      case "invoice_delay": {
        const { invoiceId, days } = adjustment;
        const invoice = (invoices as Invoice[]).find((item) => item.id === invoiceId);
        if (invoice === undefined) {
          warnings.push(`Scenario invoice_delay ignored: unknown invoice ${invoiceId}`);
          break;
        }
        if (!Number.isInteger(days)) {
          warnings.push(`Scenario invoice_delay for invoice ${invoice.invoiceNumber} ignored: days must be an integer`);
          break;
        }
        if (invoice.status === "cancelled" || invoice.cancelled === true) {
          warnings.push(`Scenario invoice_delay for invoice ${invoice.invoiceNumber} ignored: invoice is cancelled`);
          break;
        }
        // Open receivables already hold the remaining balance (amount minus payments dated on or before asOf),
        // so only that remaining balance is shifted. A fully paid invoice has no receivable entry.
        if (!receivables.some((receivable) => receivable.invoiceId === invoiceId)) {
          warnings.push(
            `Scenario invoice_delay for invoice ${invoice.invoiceNumber} ignored: no open balance to shift (fully paid or not collectable)`,
          );
          break;
        }
        receivables = receivables.map((receivable) =>
          receivable.invoiceId === invoiceId
            ? { ...receivable, expected: clampExpected(addDays(receivable.expected, days)) }
            : receivable,
        );
        assumptions.push(
          days >= 0
            ? `Scenario: invoice ${invoice.invoiceNumber} remaining balance collection delayed by ${days} day(s)`
            : `Scenario: invoice ${invoice.invoiceNumber} remaining balance collection brought forward by ${-days} day(s)`,
        );
        break;
      }
      default:
        break;
    }
  }

  // ---- Receivables into the schedule ----
  for (const receivable of receivables) {
    if (compareIso(receivable.expected, horizonEnd) > 0) {
      warnings.push(
        `Invoice ${receivable.invoiceNumber} expected on ${receivable.expected} is beyond the forecast horizon and is not collected in the forecast`,
      );
      continue;
    }
    incoming[dayIndex(receivable.expected)] += receivable.remaining;
  }
  for (const lump of fixedIncoming) {
    incoming[dayIndex(lump.date)] += lump.amount;
  }

  // ---- Expenses into the schedule ----
  // One as-of policy for one-off and recurring: before asOf = settled (skipped); exactly asOf = unpaid,
  // counted as outgoing on asOf+1 with a warning; after asOf = counted on its own date.
  const addOutgoing = (expense: Expense, occurrence: string): void => {
    if (compareIso(occurrence, asOf) < 0) return;
    let due = occurrence;
    if (compareIso(occurrence, asOf) === 0) {
      due = addDays(asOf, 1);
      warnings.push(
        `Expense ${expense.name} is due on the as-of date ${asOf}; assumed unpaid and treated as due on ${due}`,
      );
    }
    if (compareIso(due, horizonEnd) <= 0) {
      outgoing[dayIndex(due)] += expense.amount;
    }
  };

  for (const expense of workingExpenses) {
    if (!isValidIsoDate(expense.dueDate)) {
      warnings.push(`Expense ${expense.name} skipped: invalid dueDate`);
      continue;
    }
    if (!(expense.amount > 0)) {
      warnings.push(`Expense ${expense.name} ignored: amount must be greater than 0`);
      continue;
    }

    if (expense.recurrence === "weekly" || expense.recurrence === "monthly") {
      if (expense.recurrenceEndDate !== undefined && !isValidIsoDate(expense.recurrenceEndDate)) {
        warnings.push(`Expense ${expense.name} recurrenceEndDate is invalid and was ignored`);
      }
      // Series is generated from the original dueDate; only postponed occurrences are moved.
      const shifted = occurrenceShifts.get(expense.id);
      for (const original of seriesOccurrences(expense, horizonEnd)) {
        addOutgoing(expense, shifted?.get(original) ?? original);
      }
    } else {
      addOutgoing(expense, expense.dueDate);
    }
  }

  // ---- Daily balances ----
  const days: ForecastDay[] = [];
  let balance = openingBalance;
  for (let i = 0; i < horizonDays; i++) {
    balance = balance + incoming[i] - outgoing[i];
    days.push({
      date: addDays(asOf, i + 1),
      incoming: incoming[i],
      outgoing: outgoing[i],
      balance,
    });
  }

  let minimumBalance = Number.POSITIVE_INFINITY;
  let minimumBalanceDate = asOf;
  let shortageDate: string | null = null;
  let firstNegativeIndex = -1;
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (day.balance < minimumBalance) {
      minimumBalance = day.balance;
      minimumBalanceDate = day.date;
    }
    if (firstNegativeIndex < 0 && day.balance < 0) {
      firstNegativeIndex = i;
      shortageDate = day.date;
    }
  }

  const shortageAmount = Math.max(0, -minimumBalance);
  const cashRunwayDays = firstNegativeIndex >= 0 ? firstNegativeIndex + 1 : horizonDays;

  let bufferStatus: ForecastResult["bufferStatus"];
  if (minimumBalance < 0) {
    bufferStatus = "negative";
  } else if (minimumBalance < safetyBuffer) {
    bufferStatus = "below_buffer";
  } else {
    bufferStatus = "above_buffer";
  }

  let riskLevel: RiskLevel;
  if (minimumBalance < 0) {
    riskLevel = "critical";
  } else if (minimumBalance < safetyBuffer) {
    riskLevel = "high";
  } else if (cashRunwayDays <= horizonDays && minimumBalance < 2 * safetyBuffer) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  const baseAssumptions = [
    `Forecast horizon: ${horizonDays} day(s), ${addDays(asOf, 1)} to ${horizonEnd}, as of ${asOf}.`,
    `Payment delay: invoices not yet due are assumed collected ${defaultDelayDays} day(s) after their due date.`,
    `Overdue collection delay: overdue invoices are assumed collected ${overdueDelayDays} day(s) after the as-of date.`,
    "Recurring expansion: weekly expenses repeat every 7 days and monthly expenses repeat on the same day of month (clamped to month end), both generated from the original due date.",
    "As-of date policy: occurrences (one-off or recurring) dated before the as-of date are assumed already settled and skipped; an occurrence dated exactly on the as-of date is assumed unpaid, treated as due the day after, and raises a warning.",
    `Safety buffer: ${safetyBuffer} paise.`,
    "Paid amounts are derived from payments dated on or before the as-of date; payments dated after it are treated as not yet received.",
  ];

  return {
    asOfDate: asOf,
    horizonDays,
    openingBalance,
    safetyBuffer,
    days,
    minimumBalance,
    minimumBalanceDate,
    shortageDate,
    shortageAmount,
    cashRunwayDays,
    riskLevel,
    bufferStatus,
    assumptions: [...baseAssumptions, ...assumptions],
    warnings,
  };
}
