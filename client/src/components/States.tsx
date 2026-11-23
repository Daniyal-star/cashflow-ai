export function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={`kpi-${i}`} className="animate-pulse h-28 rounded-xl bg-navy-800 border border-navy-700" />
      ))}
      {Array.from({ length: 2 }, (_, i) => (
        <div
          key={`panel-${i}`}
          className="animate-pulse h-72 rounded-xl bg-navy-800 border border-navy-700 sm:col-span-2 lg:col-span-1"
        />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-6">
      <h3 className="font-semibold text-red-300">Could not load data</h3>
      <p className="mt-2 text-slate-300">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-white hover:bg-indigo-400"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-800 p-8 text-center">
      <p className="font-semibold text-slate-100">{title}</p>
      <p className="mt-2 text-slate-400">{body}</p>
    </div>
  );
}
