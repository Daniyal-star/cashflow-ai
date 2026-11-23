import { useCallback, useEffect, useState } from "react";
import { deleteInvoice, fetchCustomers, fetchInvoices } from "../api/client";
import { formatDateLabel, formatINR } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { INPUT_CLASS, LABEL_CLASS } from "../components/CustomerForm";
import InvoiceForm from "../components/InvoiceForm";
import PaymentPanel from "../components/PaymentPanel";
import type { CustomerView, InvoiceStatus, InvoiceView } from "../../../shared/types";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "sent", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Unpaid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  sent: "bg-slate-500/15 text-slate-200 border-slate-400/40",
  partially_paid: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  overdue: "bg-red-500/15 text-red-300 border-red-500/30",
  paid: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  cancelled: "bg-slate-600/20 text-slate-500 border-slate-600/40",
};

type FormState = { mode: "create" } | { mode: "edit"; invoice: InvoiceView } | null;

interface Loaded {
  customers: CustomerView[];
  invoices: InvoiceView[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function Invoices() {
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [invoices, setInvoices] = useState<InvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");

  const [form, setForm] = useState<FormState>(null);
  const [selected, setSelected] = useState<InvoiceView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce the search box so the server is not queried on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const load = useCallback(async (): Promise<Loaded> => {
    setLoading(true);
    setError(null);
    try {
      const [loadedCustomers, loadedInvoices] = await Promise.all([
        fetchCustomers(),
        fetchInvoices({ status, customerId, search }),
      ]);
      setCustomers(loadedCustomers);
      setInvoices(loadedInvoices);
      return { customers: loadedCustomers, invoices: loadedInvoices };
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [status, customerId, search]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  /** Reload the list after a payment and refresh the selected invoice so its balance is current. */
  async function handlePaymentRecorded(invoiceId: string) {
    try {
      const { invoices: latest } = await load();
      let updated = latest.find((i) => i.id === invoiceId) ?? null;
      if (!updated) {
        // The selected invoice may be filtered out of the list; fetch unfiltered to find it.
        const all = await fetchInvoices({});
        updated = all.find((i) => i.id === invoiceId) ?? null;
      }
      setSelected(updated);
    } catch {
      // load() already set the error state; keep the panel as it was.
    }
  }

  async function handleDelete(invoice: InvoiceView) {
    if (!window.confirm(`Delete invoice ${invoice.invoiceNumber}? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await deleteInvoice(invoice.id);
      if (selected?.id === invoice.id) setSelected(null);
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  function customerName(id: string): string {
    return customers.find((c) => c.id === id)?.name ?? "Unknown customer";
  }

  if (loading && !invoices) {
    return <LoadingState />;
  }

  if (error && !invoices) {
    return <ErrorState message={error} onRetry={() => void load().catch(() => undefined)} />;
  }

  const rows = invoices ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Invoices</h1>
          <p className="text-sm text-slate-400">Track invoices, record payments and watch balances.</p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ mode: "create" })}
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-navy-950 hover:bg-teal-400"
        >
          New invoice
        </button>
      </div>

      {error && <p className="text-sm text-amber-300">Showing last loaded data — refresh failed: {error}</p>}

      {actionError && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm text-red-300">{actionError}</p>
        </div>
      )}

      {form && (
        <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
          <InvoiceForm
            key={form.mode === "edit" ? form.invoice.id : "create"}
            invoice={form.mode === "edit" ? form.invoice : null}
            customers={customers}
            onSaved={() => {
              setForm(null);
              void load().catch(() => undefined);
            }}
            onCancel={() => setForm(null)}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="invoice-filter-status" className={LABEL_CLASS}>
            Status
          </label>
          <select
            id="invoice-filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={INPUT_CLASS}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="invoice-filter-customer" className={LABEL_CLASS}>
            Customer
          </label>
          <select
            id="invoice-filter-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="invoice-search" className={LABEL_CLASS}>
            Search invoice number
          </label>
          <input
            id="invoice-search"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="e.g. INV-101"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {rows.length === 0 ? (
            <EmptyState title="No invoices match these filters" body="Try changing the status, customer or search." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-800">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-navy-700 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3">Invoice</th>
                    <th scope="col" className="px-4 py-3">Customer</th>
                    <th scope="col" className="px-4 py-3">Due date</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount</th>
                    <th scope="col" className="px-4 py-3 text-right">Paid</th>
                    <th scope="col" className="px-4 py-3 text-right">Balance</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-700">
                  {rows.map((inv) => {
                    const cancelled = inv.status === "cancelled";
                    return (
                      <tr
                        key={inv.id}
                        className={`text-slate-200 ${cancelled ? "text-slate-500 line-through" : ""} ${
                          selected?.id === inv.id ? "bg-navy-700/40" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-slate-100">{inv.invoiceNumber}</td>
                        <td className="px-4 py-3">{customerName(inv.customerId)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateLabel(inv.dueDate)}</td>
                        <td className="num px-4 py-3 text-right">{formatINR(inv.amount)}</td>
                        <td className="num px-4 py-3 text-right">{formatINR(inv.paidAmount)}</td>
                        <td className="num px-4 py-3 text-right">{formatINR(inv.balance)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium no-underline ${STATUS_BADGE[inv.status]}`}
                          >
                            {STATUS_LABEL[inv.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelected(inv)}
                              aria-label={`Record payment for ${inv.invoiceNumber}`}
                              className="rounded-lg border border-teal-500/40 px-3 py-1 text-xs text-teal-300 hover:bg-teal-500/10"
                            >
                              Record payment
                            </button>
                            <button
                              type="button"
                              onClick={() => setForm({ mode: "edit", invoice: inv })}
                              aria-label={`Edit ${inv.invoiceNumber}`}
                              className="rounded-lg border border-navy-700 px-3 py-1 text-xs text-slate-200 hover:bg-navy-700"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(inv)}
                              aria-label={`Delete ${inv.invoiceNumber}`}
                              className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="min-w-0">
          {selected ? (
            <PaymentPanel
              key={selected.id}
              invoice={selected}
              onRecorded={() => void handlePaymentRecorded(selected.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-navy-700 p-5 text-sm text-slate-500">
              Select “Record payment” on an invoice to add a payment.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
