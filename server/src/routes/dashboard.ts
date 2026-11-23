/**
 * Dashboard payload for GET /api/dashboard.
 *
 * Balances, projections and risk findings come only from forecastCashFlow and detectRisks.
 * This module adds receivable totals (via openReceivables) and KPI aggregation; it does not re-project cash.
 */

import type { DashboardResponse, Dataset } from "../../../shared/types.js";
import { forecastCashFlow } from "../core/forecast.js";
import { openReceivables } from "../core/receivables.js";
import { detectRisks } from "../core/risk.js";
import { loadOrSeedDataset } from "../data/runtimeStore.js";
import type { DataRepository } from "../data/store.js";

interface CustomerBucket {
  customerId: string;
  outstanding: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  invoiceCount: number;
}

/** Build the dashboard payload from an in-memory dataset. Pure: no I/O. */
export function buildDashboardPayload(dataset: Dataset): DashboardResponse {
  const forecast = forecastCashFlow(dataset);
  const risks = detectRisks(dataset, forecast);
  const receivables = openReceivables(dataset, dataset.settings.asOfDate);

  let outstandingReceivables = 0;
  let overdueReceivables = 0;
  const buckets = new Map<string, CustomerBucket>();
  for (const item of receivables) {
    outstandingReceivables += item.remaining;
    if (item.daysOverdue > 0) overdueReceivables += item.remaining;

    const bucket = buckets.get(item.customerId) ?? {
      customerId: item.customerId,
      outstanding: 0,
      overdueAmount: 0,
      maxDaysOverdue: 0,
      invoiceCount: 0,
    };
    bucket.outstanding += item.remaining;
    if (item.daysOverdue > 0) bucket.overdueAmount += item.remaining;
    bucket.maxDaysOverdue = Math.max(bucket.maxDaysOverdue, item.daysOverdue);
    bucket.invoiceCount += 1;
    buckets.set(item.customerId, bucket);
  }

  const customerNames = new Map<string, string>();
  for (const customer of dataset.customers ?? []) {
    customerNames.set(customer.id, customer.name);
  }

  const collectionPriorities = [...buckets.values()]
    .filter((bucket) => bucket.outstanding > 0)
    .sort((a, b) => {
      if (a.overdueAmount !== b.overdueAmount) return b.overdueAmount - a.overdueAmount;
      if (a.outstanding !== b.outstanding) return b.outstanding - a.outstanding;
      if (a.customerId === b.customerId) return 0;
      return a.customerId < b.customerId ? -1 : 1;
    })
    .map((bucket) => ({
      customerId: bucket.customerId,
      customerName: customerNames.get(bucket.customerId) ?? bucket.customerId,
      outstanding: bucket.outstanding,
      overdueAmount: bucket.overdueAmount,
      maxDaysOverdue: bucket.maxDaysOverdue,
      invoiceCount: bucket.invoiceCount,
    }));

  let upcomingExpenses = 0;
  let expectedInflows = 0;
  for (const day of forecast.days) {
    upcomingExpenses += day.outgoing;
    expectedInflows += day.incoming;
  }

  return {
    asOfDate: forecast.asOfDate,
    kpis: {
      availableCash: dataset.settings.openingBalance,
      outstandingReceivables,
      overdueReceivables,
      upcomingExpenses,
      expectedInflows,
      projectedMinimumBalance: forecast.minimumBalance,
      minimumBalanceDate: forecast.minimumBalanceDate,
      cashRunwayDays: forecast.cashRunwayDays,
      shortageDate: forecast.shortageDate,
      shortageAmount: forecast.shortageAmount,
      safetyBuffer: forecast.safetyBuffer,
      riskLevel: forecast.riskLevel,
    },
    forecast,
    risks,
    collectionPriorities,
  };
}

/** Load the dataset from the store (seeding on first run) and build the payload. Reloads on every call. */
export function getDashboardPayload(repo: DataRepository): DashboardResponse {
  return buildDashboardPayload(loadOrSeedDataset(repo));
}
