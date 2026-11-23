import { useEffect, useRef, useState } from "react";
import {
  draftReminder,
  markReminderSent,
  ReminderConflictError,
  type ReminderDraftResponse,
} from "../api/client";
import { formatDateLabel, formatDays, formatINR } from "../lib/format";
import type { CollectionQueueItem, ReminderChannel, ReminderTone } from "../../../shared/types";

interface ReminderPanelProps {
  invoice: CollectionQueueItem;
  onClose: () => void;
  onSent: () => void;
}

const TONES: Array<{ value: ReminderTone; label: string }> = [
  { value: "friendly", label: "Friendly" },
  { value: "professional", label: "Professional" },
  { value: "firm", label: "Firm" },
];

const CHANNELS: Array<{ value: ReminderChannel; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
];

const INPUT_CLASS =
  "w-full rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none";
const SECONDARY_BUTTON =
  "rounded-lg border border-navy-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-navy-700 disabled:opacity-50";
const PRIMARY_BUTTON =
  "rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50";

type CopyTarget = "whatsapp" | "email";

export default function ReminderPanel({ invoice, onClose, onSent }: ReminderPanelProps) {
  const [tone, setTone] = useState<ReminderTone>("professional");
  const [draft, setDraft] = useState<ReminderDraftResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [whatsapp, setWhatsapp] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [copy, setCopy] = useState<{ target: CopyTarget; message: string } | null>(null);
  const copyTimer = useRef<number | null>(null);

  const [channels, setChannels] = useState<ReminderChannel[]>(["whatsapp", "email"]);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ReminderConflictError | null>(null);

  // Regenerate the draft on mount, on invoice change and on tone change. Regenerating resets local edits.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDraftError(null);
    setConflict(null);
    draftReminder({ invoiceId: invoice.invoiceId, tone })
      .then((result) => {
        if (cancelled) return;
        setDraft(result);
        setWhatsapp(result.whatsapp);
        setSubject(result.email.subject);
        setBody(result.email.body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDraftError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.invoiceId, tone]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyText(target: CopyTarget, text: string) {
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopy({ target, message: "Copied to clipboard" });
      copyTimer.current = window.setTimeout(() => {
        setCopy(null);
        copyTimer.current = null;
      }, 2000);
    } catch {
      setCopy({ target, message: "Copy failed — select the text and copy manually" });
    }
  }

  function toggleChannel(channel: ReminderChannel) {
    setChannelError(null);
    setChannels((current) =>
      current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel],
    );
  }

  async function send(force: boolean) {
    if (channels.length === 0) {
      setChannelError("Select at least one channel before marking as sent.");
      return;
    }
    setChannelError(null);
    setSendError(null);
    setSending(true);
    try {
      await markReminderSent({ invoiceId: invoice.invoiceId, tone, channels, force });
      setConflict(null);
      onSent();
    } catch (err) {
      if (err instanceof ReminderConflictError) {
        setConflict(err);
      } else {
        setSendError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSending(false);
    }
  }

  const recent = draft?.recentSent ?? null;
  const emailText = `Subject: ${subject}\n\n${body}`;

  return (
    <section className="rounded-xl border border-navy-700 bg-navy-800 p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Payment reminder</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-slate-400">Customer</dt>
              <dd className="text-slate-100">{invoice.customerName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Invoice</dt>
              <dd className="text-slate-100">{invoice.invoiceNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Balance</dt>
              <dd className="num text-slate-100">{formatINR(invoice.balance)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Overdue</dt>
              <dd className="num text-red-400">{formatINR(invoice.overdueAmount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Days overdue</dt>
              <dd className="text-slate-100">{formatDays(invoice.daysOverdue)}</dd>
            </div>
          </dl>
        </div>
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
          Close
        </button>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Tone</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TONES.map((option) => {
            const active = tone === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setTone(option.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  active
                    ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                    : "border-navy-700 text-slate-300 hover:bg-navy-700"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && <p className="text-sm text-slate-400">Generating draft…</p>}
      {draftError && <p className="text-sm text-red-300">{draftError}</p>}

      {recent && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          A reminder for this invoice was marked sent on {formatDateLabel(recent.date)} ({recent.tone}). Sending
          another may be a duplicate.
        </div>
      )}

      {draft && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="reminder-whatsapp" className="text-sm font-medium text-slate-200">
                WhatsApp message
              </label>
              <div className="flex items-center gap-2">
                {copy?.target === "whatsapp" && <span className="text-xs text-teal-300">{copy.message}</span>}
                <button type="button" onClick={() => void copyText("whatsapp", whatsapp)} className={SECONDARY_BUTTON}>
                  Copy WhatsApp message
                </button>
              </div>
            </div>
            <textarea
              id="reminder-whatsapp"
              rows={8}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-200">Email</span>
              <div className="flex items-center gap-2">
                {copy?.target === "email" && <span className="text-xs text-teal-300">{copy.message}</span>}
                <button type="button" onClick={() => void copyText("email", emailText)} className={SECONDARY_BUTTON}>
                  Copy email
                </button>
              </div>
            </div>
            <label htmlFor="reminder-subject" className="block text-xs text-slate-400">
              Subject
            </label>
            <input
              id="reminder-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={INPUT_CLASS}
            />
            <label htmlFor="reminder-body" className="block text-xs text-slate-400">
              Body
            </label>
            <textarea
              id="reminder-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-navy-700 pt-4">
        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className="sr-only">Channels sent</legend>
          {CHANNELS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={channels.includes(option.value)}
                onChange={() => toggleChannel(option.value)}
                className="accent-indigo-500"
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        {channelError && <p className="text-sm text-red-300">{channelError}</p>}
        {sendError && <p className="text-sm text-red-300">{sendError}</p>}

        {conflict && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
            <p>A reminder was already marked sent on {formatDateLabel(conflict.existing.date)}.</p>
            <button
              type="button"
              onClick={() => void send(true)}
              disabled={sending}
              className={`mt-2 ${SECONDARY_BUTTON}`}
            >
              Record anyway
            </button>
          </div>
        )}

        <div>
          <button type="button" onClick={() => void send(false)} disabled={sending || !draft} className={PRIMARY_BUTTON}>
            {sending ? "Saving…" : "Mark as sent"}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Messages use only recorded customer, invoice and balance details. Add your own payment details before sending.
      </p>
    </section>
  );
}
