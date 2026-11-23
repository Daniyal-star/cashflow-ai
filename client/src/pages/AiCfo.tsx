import { useCallback, useEffect, useState } from "react";
import { fetchCfoBriefing, fetchCfoScenarioBriefing, fetchInvoices } from "../api/client";
import { formatDateLabel, formatINR, type Tone } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { KpiCard } from "../components/KpiCard";
import { CfoBriefingCard } from "../components/CfoBriefingCard";
import { CfoActions } from "../components/CfoActions";
import { CfoRiskList } from "../components/CfoRiskList";
import { CfoScenarioCard, DELAY_OPTIONS } from "../components/CfoScenarioCard";
import { CfoChat } from "../components/CfoChat";
import type { AiCfoBriefing, AiCfoProviderStatus, InvoiceView } from "../../../shared/types";

const PROVIDER_BANNER: Partial<Record<AiCfoProviderStatus, { tone: string; text: string }>> = {
  not_configured: {
    tone: "border-slate-500/40 bg-slate-500/10 text-slate-300",
    text: "AI provider not configured. Showing deterministic analysis.",
  },
  unavailable: {
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    text: "AI service unavailable. Showing deterministic analysis.",
  },
  invalid_output: {
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    text: "AI response failed validation. Showing deterministic analysis.",
  },
};

export default function AiCfo() {
  const [briefing, setBriefing] = useState<AiCfoBriefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [days, setDays] = useState(DELAY_OPTIONS[0]);
  const [applying, setApplying] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBriefing(await fetchCfoBriefing());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchInvoices({})
      .then((list) => setInvoices(list.filter((i) => i.balance > 0 && i.status !== "cancelled")))
      .catch(() => setInvoices([]));
  }, [load]);

  const clearScenario = async () => {
    setInvoiceId("");
    setScenarioError(null);
    await load();
  };

  const applyScenario = async () => {
    if (!invoiceId) return;
    setApplying(true);
    setScenarioError(null);
    try {
      setBriefing(await fetchCfoScenarioBriefing([{ type: "invoice_delay", invoiceId, days }]));
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  if (loading && !briefing) {
    return <LoadingState />;
  }

  if (error && !briefing) {
    return <ErrorState message={error} onRetry={load} />;
  }

  if (!briefing) {
    return <EmptyState title="No data" body="The AI CFO has no briefing to show yet." />;
  }

  const m = briefing.metrics;
  const banner = PROVIDER_BANNER[briefing.providerStatus];
  const minTone: Tone =
    m.projectedMinimumBalance < 0 ? "red" : m.projectedMinimumBalance < m.safetyBuffer ? "amber" : "teal";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">AI CFO</h1>
        <p className="text-sm text-slate-400">
          Explanations are generated from calculated figures. Numbers come from the forecast engine, never from AI.
        </p>
      </div>

      {banner && <div className={`rounded-xl border p-4 text-sm ${banner.tone}`}>{banner.text}</div>}
      {error && <p className="text-sm text-amber-300">Refresh failed: {error}</p>}

      <CfoBriefingCard briefing={briefing} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="Available cash" value={formatINR(m.availableCash)} tone="neutral" />
        <KpiCard
          label="Projected minimum"
          value={formatINR(m.projectedMinimumBalance)}
          hint={`on ${formatDateLabel(m.minimumBalanceDate)}`}
          tone={minTone}
        />
        <KpiCard
          label="Shortage"
          value={m.shortageDate ? `from ${formatDateLabel(m.shortageDate)}` : "None in horizon"}
          hint={m.shortageDate ? formatINR(m.shortageAmount) : undefined}
          tone={m.shortageDate ? "red" : "teal"}
        />
        <KpiCard
          label="Overdue receivables"
          value={formatINR(m.overdueReceivables)}
          tone={m.overdueReceivables > 0 ? "amber" : "neutral"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <CfoActions actions={briefing.actions} />
        <CfoRiskList risks={briefing.risks} />
      </div>

      <CfoScenarioCard
        scenario={briefing.scenario}
        invoices={invoices}
        invoiceId={invoiceId}
        days={days}
        applying={applying}
        scenarioError={scenarioError}
        onInvoiceChange={setInvoiceId}
        onDaysChange={setDays}
        onApply={applyScenario}
        onClear={clearScenario}
      />

      <CfoChat />

      <p className="text-xs text-slate-500">
        Figures are calculated from recorded invoices, payments and expenses. Chat answers use the same calculated
        facts; AI only rewords them.
      </p>
    </div>
  );
}
