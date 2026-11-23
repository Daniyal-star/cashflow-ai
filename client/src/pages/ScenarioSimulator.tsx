import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { compareScenario, fetchCustomers, fetchForecast, fetchInvoices } from "../api/client";
import { formatDateLabel } from "../lib/format";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { ScenarioForm } from "../components/ScenarioPanel";
import { ScenarioResults } from "../components/ScenarioResults";
import type {
  CustomerView,
  ForecastResult,
  InvoiceView,
  ScenarioAdjustment,
  ScenarioComparison,
} from "../../../shared/types";

export default function ScenarioSimulator() {
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [baseline, setBaseline] = useState<ForecastResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [comparison, setComparison] = useState<ScenarioComparison | null>(null);
  const [runDays, setRunDays] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Incremented on every run and reset so a late response from an older run is ignored.
  const runId = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [customerList, invoiceList, forecast] = await Promise.all([
        fetchCustomers(),
        fetchInvoices({}),
        fetchForecast(),
      ]);
      setCustomers(customerList);
      setInvoices(invoiceList);
      setBaseline(forecast);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRun = useCallback(async (adjustment: ScenarioAdjustment, days: number) => {
    const id = ++runId.current;
    setRunning(true);
    setRunError(null);
    setComparison(null);
    setRunDays(days);
    try {
      const result = await compareScenario([adjustment]);
      if (id === runId.current) setComparison(result);
    } catch (err) {
      if (id === runId.current) setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === runId.current) setRunning(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    runId.current += 1;
    setRunning(false);
    setComparison(null);
    setRunDays(null);
    setRunError(null);
  }, []);

  if (loading && !baseline) {
    return <LoadingState />;
  }

  if (loadError && !baseline) {
    return <ErrorState message={loadError} onRetry={load} />;
  }

  if (!baseline) {
    return <EmptyState title="No forecast" body="The baseline forecast has no data to simulate yet." />;
  }

  if (baseline.days.length === 0) {
    return <EmptyState title="No forecast days" body="There are no forecast days to simulate yet." />;
  }

  let resultPanel: ReactNode;
  if (running) {
    resultPanel = (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl border border-navy-700 bg-navy-800" />
        <div className="h-80 animate-pulse rounded-xl border border-navy-700 bg-navy-800" />
      </div>
    );
  } else if (runError) {
    resultPanel = <ErrorState message={runError} />;
  } else if (comparison && runDays !== null) {
    resultPanel = <ScenarioResults comparison={comparison} days={runDays} />;
  } else {
    resultPanel = (
      <EmptyState
        title="No scenario run"
        body="Choose a customer or invoice and a delay, then run the scenario to compare it with the baseline."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Scenario Simulator</h1>
        <p className="text-sm text-slate-400">
          Baseline from {formatDateLabel(baseline.asOfDate)} · {baseline.horizonDays} days
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr] xl:items-start">
        <ScenarioForm
          customers={customers}
          invoices={invoices}
          running={running}
          onRun={handleRun}
          onReset={handleReset}
        />
        <div>{resultPanel}</div>
      </div>
    </div>
  );
}
