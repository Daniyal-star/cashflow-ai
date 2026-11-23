import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendCfoChat } from "../api/client";
import { ChatBubble, ThinkingBubble, type ChatEntry } from "./CfoChatBubble";
import type { AiCfoChatMessage } from "../../../shared/types";

const QUICK_PROMPTS = [
  "Why will I run out of money?",
  "What should I do today?",
  "Which customer should I contact first?",
  "Who should I collect from first?",
  "What happens if Sharma Textiles pays 15 days late?",
  "How can I prevent the projected shortage?",
  "Can I afford my upcoming expenses?",
];

const HISTORY_LIMIT = 10;
const MAX_LENGTH = 500;

export function CfoChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [messages.length, pending]);

  const send = async (raw: string, fromInput: boolean) => {
    const text = raw.trim();
    if (!text || pending) return;

    const history: AiCfoChatMessage[] = messages
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content }));

    setPending(true);
    setError(null);
    try {
      const response = await sendCfoChat({ message: text, history });
      const userId = ++idRef.current;
      const botId = ++idRef.current;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: text },
        { id: botId, role: "assistant", content: response.answer, response },
      ]);
      if (fromInput) setInput("");
    } catch (err) {
      // The question stays in the input (or the prompt is re-sendable) so the user can retry.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(input, true);
  };

  return (
    <section className="rounded-xl border border-navy-700 bg-navy-800 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Ask your AI CFO</h2>
        <p className="mt-1 text-xs text-slate-400">
          Answers use the same calculated facts as this page. Conversation is kept for this session only.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => void send(p, false)}
            className="rounded-full border border-navy-700 bg-navy-900 px-3 py-1.5 text-left text-xs text-slate-300 hover:border-indigo-400/50 hover:text-slate-100 disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>

      <div
        role="log"
        aria-live="polite"
        className="mt-4 max-h-[28rem] min-h-[10rem] space-y-3 overflow-y-auto rounded-lg border border-navy-700 bg-navy-950/40 p-3 sm:p-4"
      >
        {messages.length === 0 && !pending && (
          <p className="py-6 text-center text-sm text-slate-500">
            Ask a question or pick a prompt above to start.
          </p>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} entry={m} />
        ))}
        {pending && <ThinkingBubble />}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label htmlFor="cfo-chat-input" className="sr-only">
          Ask a question about your business
        </label>
        <input
          id="cfo-chat-input"
          type="text"
          value={input}
          maxLength={MAX_LENGTH}
          disabled={pending}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Can I pay rent next month?"
          className="min-w-0 flex-1 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || input.trim().length === 0}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
