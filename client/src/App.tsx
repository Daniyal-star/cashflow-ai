import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
const Reminders = lazy(() => import("./pages/Reminders"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerIntelligence = lazy(() => import("./pages/CustomerIntelligence"));
const Invoices = lazy(() => import("./pages/Invoices"));
const CashForecast = lazy(() => import("./pages/CashForecast"));
const ScenarioSimulator = lazy(() => import("./pages/ScenarioSimulator"));
const AiCfo = lazy(() => import("./pages/AiCfo"));
const Collections = lazy(() => import("./pages/Collections"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));
const ImportAnalytics = lazy(() => import("./pages/ImportAnalytics"));
const fallback = <div className="p-8 text-sm text-slate-400">Loading…</div>;

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Suspense fallback={fallback}><Dashboard /></Suspense>} />
        <Route path="invoices" element={<Suspense fallback={fallback}><Invoices /></Suspense>} />
        <Route path="forecast" element={<Suspense fallback={fallback}><CashForecast /></Suspense>} />
        <Route path="simulator" element={<Suspense fallback={fallback}><ScenarioSimulator /></Suspense>} />
        <Route path="customers" element={<Suspense fallback={fallback}><CustomerIntelligence /></Suspense>} />
        <Route path="customers/manage" element={<Suspense fallback={fallback}><Customers /></Suspense>} />
        <Route path="ai-cfo" element={<Suspense fallback={fallback}><AiCfo /></Suspense>} />
        <Route path="collections" element={<Suspense fallback={fallback}><Collections /></Suspense>} />
        <Route path="import" element={<Suspense fallback={fallback}><ImportAnalytics /></Suspense>} />            <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
