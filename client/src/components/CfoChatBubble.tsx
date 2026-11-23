import type { AiCfoChatBasis, AiCfoChatResponse } from "../../../shared/types";

export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  content: string;
  response?: AiCfoChatResponse;
}

const BASIS_LABEL: Record<AiCfoChatBasis, string> = {
  actual: "Actual data",
  forecast: "Forecast estimate",
  scenario: "Hypothetical scenario",
  mixed: "Mixed sources",
};

type FactTag = "actual" | "forecast" | "scenario";

const FACT_BADGE: Record<FactTag | "fact", { label: string; tone: string }> = {
  actual: { label: "Actual", tone: "border-teal-500/30 bg-teal-500/10 text-teal-300" },
  forecast: { label: "Forecast", tone: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300" },
  scenario: { label: "Scenario", tone: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  fact: { label: "Fact", tone: "border-navy-700 bg-navy-800 text-slate-400" },
};

const TAG_PATTERN = /^\[(actual|forecast|scenario)\]\s*/i;
const BAD_FACT_PATTERN = /undefined|NaN/;

interface ParsedFact {
  key: number;
  tag: FactTag | "fact";
  text: string;
}

/** Keeps only string facts with real content; splits off a leading [tag] for badge display. */
function parseFacts(facts: unknown): ParsedFact[] {
  if (!Array.isArray(facts)) return [];
  const out: ParsedFact[] = [];
  facts.forEach((raw, i) => {
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || BAD_FACT_PATTERN.test(trimmed)) return;
    const match = TAG_PATTERN.exec(trimmed);
    const tag: FactTag | "fact" = match ? (match[1].toLowerCase() as FactTag) : "fact";
    const text = match ? trimmed.slice(match[0].length).trim() : trimmed;
    if (text.length === 0 || BAD_FACT_PATTERN.test(text)) return;
    out.push({ key: i, tag, text });
  });
  return out;
}

function AssistantBubble({ entry }: { entry: ChatEntry }) {
  const r = entry.response;
  const fallback = r?.providerStatus === "unavailable" || r?.providerStatus === "invalid_output";
  const facts = r ? parseFacts(r.facts) : [];

  return (
    <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-navy-700 bg-navy-900 px-4 py-3 sm:max-w-[80%]">
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">{entry.content}</p>
      {r && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">
              {BASIS_LABEL[r.basis]}
            </span>
            <span className="rounded-md border border-navy-700 bg-navy-800 px-2 py-0.5 text-slate-400">
              {r.source === "ai" ? "AI-worded" : "Calculated locally"}
            </span>
          </div>
          {fallback && (
            <p className="mt-2 text-xs text-amber-300">AI unavailable — showing calculated answer.</p>
          )}
          {facts.length > 0 && (
            <details className="mt-2 text-xs text-slate-400">
              <summary className="cursor-pointer text-indigo-300 hover:text-indigo-200">Facts used</summary>
              <ul className="mt-2 space-y-1.5">
                {facts.map((f) => (
                  <li key={f.key} className="flex items-start gap-2">
                    <span
                      className={`mt-px shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${FACT_BADGE[f.tag].tone}`}
                    >
                      {FACT_BADGE[f.tag].label}
                    </span>
                    <span className="min-w-0 text-slate-300">{f.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function ChatBubble({ entry }: { entry: ChatEntry }) {
  if (entry.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-500/20 px-4 py-2 sm:max-w-[70%]">
        <p className="whitespace-pre-line text-sm text-slate-100">{entry.content}</p>
      </div>
    );
  }
  return <AssistantBubble entry={entry} />;
}

export function ThinkingBubble() {
  return (
    <div role="status" className="max-w-[60%] animate-pulse rounded-2xl rounded-bl-sm border border-navy-700 bg-navy-900 px-4 py-2">
      <p className="text-sm text-slate-400">Thinking…</p>
    </div>
  );
}
