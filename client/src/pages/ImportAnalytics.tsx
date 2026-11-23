
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  confirmImport,
  fetchCustomers,
  fetchDashboard,
  fetchInvoices,
  previewImport,
  type ImportPreview,
  type ImportResult,
  type ImportType,
} from "../api/client";

import { formatINR } from "../lib/format";
import { KpiCard } from "../components/KpiCard";
import { ErrorState, LoadingState } from "../components/States";
import type {
  CustomerView,
  DashboardResponse,
  InvoiceStatus,
  InvoiceView,
} from "../../../shared/types";

const PANEL = "rounded-xl border border-navy-700 bg-navy-800 p-5";
const INPUT =
  "w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500";
const BUTTON =
  "rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Unpaid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "#64748b",
  sent: "#94a3b8",
  partially_paid: "#f59e0b",
  overdue: "#ef4444",
  paid: "#14b8a6",
  cancelled: "#475569",
};

interface AnalyticsData {
  dashboard: DashboardResponse;
  invoices: InvoiceView[];
  customers: CustomerView[];
}

function getMonthLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

function moneyAxis(value: number): string {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(0)}K`;
  return `₹${value}`;
}

export default function ImportAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [importType, setImportType] = useState<ImportType>("customers");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [dashboard, invoices, customers] = await Promise.all([
        fetchDashboard(),
        fetchInvoices({}),
        fetchCustomers(),
      ]);

      setData({ dashboard, invoices, customers });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeInvoices = useMemo(
    () => (data?.invoices ?? []).filter((invoice) => invoice.status !== "cancelled"),
    [data],
  );

  const analytics = useMemo(() => {
    const invoices = activeInvoices;
    const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
    const totalCollected = invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0);
    const outstanding = invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
    const overdue = invoices
      .filter((invoice) => invoice.status === "overdue")
      .reduce((sum, invoice) => sum + invoice.balance, 0);

    const monthlyMap = new Map<
      string,
      { month: string; invoiced: number; collected: number; sort: string }
    >();

    for (const invoice of invoices) {
      const month = getMonthLabel(invoice.issueDate);
      const current = monthlyMap.get(month) ?? {
        month,
        invoiced: 0,
        collected: 0,
        sort: invoice.issueDate.slice(0, 7),
      };

      current.invoiced += invoice.amount / 100;
      current.collected += invoice.paidAmount / 100;
      monthlyMap.set(month, current);
    }

    const monthly = Array.from(monthlyMap.values()).sort((a, b) =>
      a.sort.localeCompare(b.sort),
    );

    const customerMap = new Map<string, number>();
    for (const invoice of invoices) {
      customerMap.set(
        invoice.customerId,
        (customerMap.get(invoice.customerId) ?? 0) + invoice.balance,
      );
    }

    const topCustomers = Array.from(customerMap.entries())
      .map(([id, balance]) => ({
        name: data?.customers.find((customer) => customer.id === id)?.name ?? "Unknown",
        outstanding: balance / 100,
      }))
      .filter((customer) => customer.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 7);

    const statusMap = new Map<InvoiceStatus, number>();
    for (const invoice of invoices) {
      statusMap.set(invoice.status, (statusMap.get(invoice.status) ?? 0) + 1);
    }

    const statuses = Array.from(statusMap.entries()).map(([status, count]) => ({
      name: STATUS_LABEL[status],
      value: count,
      color: STATUS_COLORS[status],
    }));

    return {
      totalInvoiced,
      totalCollected,
      outstanding,
      overdue,
      monthly,
      topCustomers,
      statuses,
      invoiceCount: invoices.length,
      customerCount: data?.customers.length ?? 0,
    };
  }, [activeInvoices, data]);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setPreview(null);
    setResult(null);
    setCsv("");
    setFileName(file.name);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Please select a CSV file.");
      return;
    }

    if (file.size > 90 * 1024) {
      setImportError("File is too large. Maximum supported size is 90 KB.");
      return;
    }

    try {
      setCsv(await file.text());
    } catch {
      setImportError("Could not read this file.");
    }
  }

  async function handlePreview() {
    if (!csv.trim()) {
      setImportError("Choose a CSV file first.");
      return;
    }

    setWorking(true);
    setImportError(null);
    setPreview(null);
    setResult(null);

    try {
      const response = await previewImport(importType, csv);
      setPreview(response);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleConfirm() {
    if (!preview || preview.validCount === 0) return;

    const accepted = window.confirm(
      `Import ${preview.validCount} valid ${importType} rows? Invalid and duplicate rows will be skipped.`,
    );
    if (!accepted) return;

    setWorking(true);
    setImportError(null);

    try {
      const response = await confirmImport(importType, csv);
      setResult(response);
      setPreview(null);
      setCsv("");
      setFileName("");
      await load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  function changeType(value: ImportType) {
    setImportType(value);
    setPreview(null);
    setResult(null);
    setCsv("");
    setFileName("");
    setImportError(null);
  }

  if (loading && !data) return <LoadingState />;
  if (error && !data) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">
            Import & Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Import business records and understand your financial performance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-300 hover:bg-navy-700"
        >
          Refresh analytics
        </button>
      </div>

      {error && (
        <p className="text-sm text-amber-300">
          Refresh failed: {error}
        </p>
      )}

      {/* Import section */}
      <section className={PANEL}>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-100">Import business data</h2>
          <p className="mt-1 text-sm text-slate-400">
            Upload a CSV, review the validation results and confirm the import.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">
              Data type
            </label>
            <select
              value={importType}
              onChange={(event) => changeType(event.target.value as ImportType)}
              className={INPUT}
            >
              <option value="customers">Customers</option>
              <option value="invoices">Invoices</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">
              CSV file
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFile(event)}
              className={`${INPUT} file:mr-3 file:rounded-md file:border-0 file:bg-navy-700 file:px-3 file:py-1 file:text-xs file:text-slate-200`}
            />
          </div>
        </div>

        {fileName && (
          <p className="mt-3 text-xs text-slate-400">
            Selected file: <span className="text-slate-200">{fileName}</span>
          </p>
        )}

        <div className="mt-4 rounded-lg border border-navy-700 bg-navy-900/60 p-4">
          <p className="text-sm font-medium text-slate-200">Required CSV columns</p>
          {importType === "customers" ? (
            <>
              <code className="mt-2 block break-all text-xs text-teal-300">
                name,email,phone
              </code>
              <p className="mt-2 text-xs text-slate-500">
                Only name is required. Email and phone are optional.
              </p>
            </>
          ) : (
            <>
              <code className="mt-2 block break-all text-xs text-teal-300">
                invoiceNumber,customerName,issueDate,dueDate,amount
              </code>
              <p className="mt-2 text-xs text-slate-500">
                Amount must be in rupees. Dates must use YYYY-MM-DD.
                Customers must already exist.
              </p>
            </>
          )}
        </div>

        {importError && (
          <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {importError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!csv.trim() || working}
            onClick={() => void handlePreview()}
            className={BUTTON}
          >
            {working ? "Processing..." : "Preview CSV"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCsv("");
              setFileName("");
              setPreview(null);
              setResult(null);
              setImportError(null);
            }}
            className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-300 hover:bg-navy-700"
          >
            Clear
          </button>
        </div>

        {preview && (
          <div className="mt-6 space-y-4 border-t border-navy-700 pt-5">
            <h3 className="font-semibold text-slate-100">Import preview</h3>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-navy-900 p-3">
                <p className="text-xs text-slate-400">Total rows</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{preview.totalRows}</p>
              </div>
              <div className="rounded-lg bg-teal-500/10 p-3">
                <p className="text-xs text-teal-300">Valid rows</p>
                <p className="mt-1 text-xl font-semibold text-teal-300">{preview.validCount}</p>
              </div>
              <div className="rounded-lg bg-red-500/10 p-3">
                <p className="text-xs text-red-300">Invalid / duplicate</p>
                <p className="mt-1 text-xl font-semibold text-red-300">{preview.invalidCount}</p>
              </div>
            </div>

            {preview.validRows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-navy-700">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-navy-900 text-slate-400">
                    <tr>
                      {Object.keys(preview.validRows[0]).map((key) => (
                        <th key={key} className="px-3 py-3 font-medium">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-700">
                    {preview.validRows.slice(0, 20).map((row, index) => (
                      <tr key={index} className="text-slate-300">
                        {Object.keys(preview.validRows[0]).map((key) => (
                          <td key={key} className="px-3 py-3">
                            {row[key] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.validRows.length > 20 && (
                  <p className="border-t border-navy-700 px-3 py-2 text-xs text-slate-500">
                    Showing first 20 of {preview.validRows.length} valid rows.
                  </p>
                )}
              </div>
            )}

            {preview.issues.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-red-300">Rows requiring attention</h4>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {preview.issues.map((issue, index) => (
                    <div key={`${issue.line}-${index}`} className="rounded-lg bg-red-500/5 p-3 text-xs text-slate-300">
                      <span className="font-semibold text-red-300">Row {issue.line}: </span>
                      {issue.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={preview.validCount === 0 || working}
              onClick={() => void handleConfirm()}
              className={BUTTON}
            >
              {working ? "Importing..." : `Confirm import (${preview.validCount})`}
            </button>
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-lg border border-teal-500/30 bg-teal-500/10 p-4">
            <h3 className="font-semibold text-teal-300">Import completed</h3>
            <p className="mt-2 text-sm text-slate-200">
              Successfully imported {result.importedCount} records.
              {" "}{result.skippedCount} rows were skipped.
            </p>
            {result.issues.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-slate-300">
                {result.issues.map((issue, index) => (
                  <p key={index}>Row {issue.line}: {issue.message}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Analytics section */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Business analytics</h2>
          <p className="text-sm text-slate-400">
            Calculated from your current invoice and customer records.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total invoiced" value={formatINR(analytics.totalInvoiced)} tone="neutral" />
          <KpiCard label="Total collected" value={formatINR(analytics.totalCollected)} tone="teal" />
          <KpiCard label="Outstanding" value={formatINR(analytics.outstanding)} tone="amber" />
          <KpiCard label="Overdue amount" value={formatINR(analytics.overdue)} tone={analytics.overdue > 0 ? "red" : "teal"} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total invoices" value={String(analytics.invoiceCount)} tone="neutral" />
          <KpiCard label="Customers" value={String(analytics.customerCount)} tone="neutral" />
          <KpiCard label="Available cash" value={formatINR(data.dashboard.kpis.availableCash)} tone="neutral" />
          <KpiCard label="Expected inflows" value={formatINR(data.dashboard.kpis.expectedInflows)} tone="teal" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={PANEL}>
          <h3 className="font-semibold text-slate-100">Monthly invoice performance</h3>
          <p className="mb-4 mt-1 text-xs text-slate-400">
            Invoice value and payments recorded, grouped by invoice issue month.
          </p>
          {analytics.monthly.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">No invoice data available.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.monthly}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tickFormatter={moneyAxis} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <Tooltip formatter={(value) => formatINR(Number(value) * 100)} />
                  <Legend />
                  <Bar dataKey="invoiced" name="Invoiced" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="collected" name="Collected" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className={PANEL}>
          <h3 className="font-semibold text-slate-100">Invoice status distribution</h3>
          <p className="mb-4 mt-1 text-xs text-slate-400">
            Number of active invoices by payment status.
          </p>
          {analytics.statuses.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500">No invoice data available.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statuses}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {analytics.statuses.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className={PANEL}>
        <h3 className="font-semibold text-slate-100">Customers with highest outstanding balances</h3>
        <p className="mb-4 mt-1 text-xs text-slate-400">
          Customers ranked by unpaid invoice balances.
        </p>

        {analytics.topCustomers.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No outstanding customer balances.
          </p>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.topCustomers} layout="vertical" margin={{ left: 15, right: 25 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={moneyAxis} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fill: "#cbd5e1", fontSize: 11 }}
                />
                <Tooltip formatter={(value) => formatINR(Number(value) * 100)} />
                <Bar dataKey="outstanding" name="Outstanding" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Analytics exclude cancelled invoices. Amounts are calculated from invoice records and recorded payments.
        Forecast figures are supplied separately by the cash-flow engine.
      </p>
    </div>
  );
}
