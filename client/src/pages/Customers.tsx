import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteCustomer, fetchCustomers } from "../api/client";
import { formatINR } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import CustomerForm, { INPUT_CLASS, LABEL_CLASS } from "../components/CustomerForm";
import type { CustomerView } from "../../../shared/types";

type FormState = { mode: "create" } | { mode: "edit"; customer: CustomerView } | null;

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCustomers(await fetchCustomers());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    return q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
  }, [customers, search]);

  async function handleDelete(customer: CustomerView) {
    if (!window.confirm(`Delete customer "${customer.name}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await deleteCustomer(customer.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSaved() {
    setForm(null);
    void load();
  }

  if (loading && !customers) {
    return <LoadingState />;
  }

  if (error && !customers) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const all = customers ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Customers</h1>
          <p className="text-sm text-slate-400">Manage customers and see what each one owes.</p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ mode: "create" })}
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-navy-950 hover:bg-teal-400"
        >
          New customer
        </button>
      </div>

      {error && (
        <p className="text-sm text-amber-300">Showing last loaded data — refresh failed: {error}</p>
      )}

      {actionError && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm text-red-300">{actionError}</p>
        </div>
      )}

      {form && (
        <div className="rounded-xl border border-navy-700 bg-navy-800 p-5">
          <CustomerForm
            key={form.mode === "edit" ? form.customer.id : "create"}
            customer={form.mode === "edit" ? form.customer : null}
            onSaved={handleSaved}
            onCancel={() => setForm(null)}
          />
        </div>
      )}

      <div>
        <label htmlFor="customer-search" className={LABEL_CLASS}>
          Search by name
        </label>
        <input
          id="customer-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="e.g. Sharma"
          className={`${INPUT_CLASS} max-w-sm`}
        />
      </div>

      {all.length === 0 ? (
        <EmptyState title="No customers yet" body="Create your first customer to start tracking invoices." />
      ) : visible.length === 0 ? (
        <EmptyState title="No customers match your search" body="Try a different name." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-700 bg-navy-800">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-navy-700 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3">Phone</th>
                <th scope="col" className="px-4 py-3 text-right">Invoices</th>
                <th scope="col" className="px-4 py-3 text-right">Outstanding</th>
                <th scope="col" className="px-4 py-3 text-right">Overdue</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {visible.map((c) => (
                <tr key={c.id} className="text-slate-200">
                  <td className="px-4 py-3 font-medium text-slate-100">{c.name}</td>
                  <td className="px-4 py-3 text-slate-400">{c.email || "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{c.phone || "—"}</td>
                  <td className="num px-4 py-3 text-right">{c.invoiceCount}</td>
                  <td className="num px-4 py-3 text-right">{formatINR(c.outstanding)}</td>
                  <td className={`num px-4 py-3 text-right ${c.overdueAmount > 0 ? "font-semibold text-red-400" : ""}`}>
                    {formatINR(c.overdueAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setForm({ mode: "edit", customer: c })}
                        aria-label={`Edit ${c.name}`}
                        className="rounded-lg border border-navy-700 px-3 py-1 text-xs text-slate-200 hover:bg-navy-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(c)}
                        aria-label={`Delete ${c.name}`}
                        className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">Customers with invoices cannot be deleted.</p>
    </div>
  );
}
