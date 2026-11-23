import { EmptyState } from "./States";
import { formatDays, formatINR } from "../lib/format";
import type { DashboardResponse } from "../../../shared/types";

export function CollectionPriorities({ items }: { items: DashboardResponse["collectionPriorities"] }) {
  return (
    <section className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Collection priorities</h2>
      <p className="text-xs text-slate-400">Ranked by overdue amount, then outstanding</p>

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState
            title="No outstanding receivables"
            body="All recorded invoices are settled or cancelled."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-400">
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2 text-right font-medium">Overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Max days overdue</th>
                  <th className="px-3 py-2 text-right font-medium">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.customerId} className="border-t border-navy-700">
                    <td className="px-3 py-2 text-slate-100">{c.customerName}</td>
                    <td className="num px-3 py-2 text-right text-slate-200">{formatINR(c.outstanding)}</td>
                    <td
                      className={`num px-3 py-2 text-right ${c.overdueAmount > 0 ? "text-red-400" : "text-slate-400"}`}
                    >
                      {formatINR(c.overdueAmount)}
                    </td>
                    <td className="num px-3 py-2 text-right text-slate-200">
                      {c.maxDaysOverdue > 0 ? formatDays(c.maxDaysOverdue) : "—"}
                    </td>
                    <td className="num px-3 py-2 text-right text-slate-200">{c.invoiceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
