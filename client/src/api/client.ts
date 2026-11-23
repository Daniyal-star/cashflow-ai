import type {
  AiCfoBriefing,
  AiCfoChatRequest,
  AiCfoChatResponse,
  CollectionsSummary,
  CustomerIntelligence,
  CustomerInput,
  CustomerView,
  DashboardResponse,
  ForecastResult,
  InvoiceInput,
  InvoiceView,
  Payment,
  PaymentInput,
  ReminderChannel,
  ReminderRecord,
  ReminderTone,
  ScenarioAdjustment,
  ScenarioComparison,
} from "../../../shared/types";

export async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Cannot reach the server. Is the backend running?");
  }

  if (!res.ok) {
    let body: { error?: string } = {};
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      // ignore parse errors
    }
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const fetchDashboard = (): Promise<DashboardResponse> =>
  fetchJson<DashboardResponse>("/api/dashboard");

/* ---------- Forecast & scenarios ---------- */

export const fetchForecast = (): Promise<ForecastResult> =>
  fetchJson<ForecastResult>("/api/forecast");

export const compareScenario = (adjustments: ScenarioAdjustment[]): Promise<ScenarioComparison> =>
  requestJson<ScenarioComparison>("POST", "/api/forecast/scenario", { adjustments });

/** JSON request helper for mutations. Returns undefined on 204 No Content. */
export async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Cannot reach the server. Is the backend running?");
  }

  if (!res.ok) {
    let errBody: { error?: string } = {};
    try {
      errBody = (await res.json()) as { error?: string };
    } catch {
      // ignore parse errors
    }
    throw new Error(errBody.error ?? `Request failed with status ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/* ---------- Customers ---------- */

export const fetchCustomers = (): Promise<CustomerView[]> =>
  fetchJson<CustomerView[]>("/api/customers");

export const createCustomer = (input: CustomerInput): Promise<CustomerView> =>
  requestJson<CustomerView>("POST", "/api/customers", input);

export const updateCustomer = (id: string, input: Partial<CustomerInput>): Promise<CustomerView> =>
  requestJson<CustomerView>("PUT", `/api/customers/${encodeURIComponent(id)}`, input);

export const deleteCustomer = (id: string): Promise<void> =>
  requestJson<void>("DELETE", `/api/customers/${encodeURIComponent(id)}`);

/* ---------- Invoices ---------- */

export interface InvoiceQuery {
  status?: string;
  customerId?: string;
  search?: string;
}

export function fetchInvoices(params: InvoiceQuery): Promise<InvoiceView[]> {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
  return fetchJson<InvoiceView[]>(`/api/invoices${qs}`);
}

export const createInvoice = (input: InvoiceInput): Promise<InvoiceView> =>
  requestJson<InvoiceView>("POST", "/api/invoices", input);

export const updateInvoice = (id: string, input: Partial<InvoiceInput>): Promise<InvoiceView> =>
  requestJson<InvoiceView>("PUT", `/api/invoices/${encodeURIComponent(id)}`, input);

export const deleteInvoice = (id: string): Promise<void> =>
  requestJson<void>("DELETE", `/api/invoices/${encodeURIComponent(id)}`);

export const recordPayment = (invoiceId: string, input: PaymentInput): Promise<Payment> =>
  requestJson<Payment>("POST", `/api/invoices/${encodeURIComponent(invoiceId)}/payments`, input);

/* ---------- Customer intelligence ---------- */

export const fetchCustomerIntelligence = (): Promise<CustomerIntelligence[]> =>
  fetchJson<CustomerIntelligence[]>("/api/intelligence/customers");

export const fetchCustomerIntelligenceDetail = (id: string): Promise<CustomerIntelligence> =>
  fetchJson<CustomerIntelligence>(`/api/intelligence/customers/${encodeURIComponent(id)}`);

/* ---------- AI CFO ---------- */

export const fetchCfoBriefing = (): Promise<AiCfoBriefing> =>
  fetchJson<AiCfoBriefing>("/api/cfo/briefing");

export const fetchCfoScenarioBriefing = (adjustments: ScenarioAdjustment[]): Promise<AiCfoBriefing> =>
  requestJson<AiCfoBriefing>("POST", "/api/cfo/briefing/scenario", { adjustments });

export const sendCfoChat = (req: AiCfoChatRequest): Promise<AiCfoChatResponse> =>
  requestJson<AiCfoChatResponse>("POST", "/api/cfo/chat", req);

/* ---------- Smart Collections ---------- */

export const fetchCollectionsSummary = (): Promise<CollectionsSummary> =>
  fetchJson<CollectionsSummary>("/api/collections/summary");

/* ---------- Payment reminders ---------- */

export interface DraftReminderRequest {
  invoiceId: string;
  tone: ReminderTone;
  senderName?: string;
}

export interface ReminderDraftResponse {
  reminder: {
    invoiceId: string;
    customerId: string;
    tone: ReminderTone;
    date: string;
    balance: number;
  };
  whatsapp: string;
  email: { subject: string; body: string };
  recentSent: ReminderRecord | null;
}

export interface MarkReminderSentRequest {
  invoiceId: string;
  tone: ReminderTone;
  channels: ReminderChannel[];
  force?: boolean;
}

/** Thrown by markReminderSent when a recent reminder exists and force was not set (HTTP 409). */
export class ReminderConflictError extends Error {
  readonly existing: ReminderRecord;

  constructor(message: string, existing: ReminderRecord) {
    super(message);
    this.name = "ReminderConflictError";
    this.existing = existing;
    Object.setPrototypeOf(this, ReminderConflictError.prototype);
  }
}

export const draftReminder = (req: DraftReminderRequest): Promise<ReminderDraftResponse> =>
  requestJson<ReminderDraftResponse>("POST", "/api/reminders/draft", req);

/** Resolves with the recorded reminder. Throws ReminderConflictError on 409. */
export async function markReminderSent(req: MarkReminderSentRequest): Promise<ReminderRecord> {
  let res: Response;
  try {
    res = await fetch("/api/reminders/mark-sent", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new Error("Cannot reach the server. Is the backend running?");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; existing?: ReminderRecord };
    if (res.status === 409 && body.existing) {
      throw new ReminderConflictError(body.error ?? "A reminder was already recorded.", body.existing);
    }
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }

  const payload = (await res.json()) as { reminder: ReminderRecord };
  return payload.reminder;
}

export function fetchReminders(invoiceId?: string): Promise<ReminderRecord[]> {
  const qs = invoiceId ? `?invoiceId=${encodeURIComponent(invoiceId)}` : "";
  return fetchJson<ReminderRecord[]>(`/api/reminders${qs}`);
}

/* ---------- CSV Import ---------- */

export type ImportType = "customers" | "invoices";

export interface ImportPreview {
  type: ImportType;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  validRows: Array<Record<string, string>>;
  issues: Array<{ line: number; message: string }>;
}

export interface ImportResult {
  type: ImportType;
  importedCount: number;
  skippedCount: number;
  issues: Array<{ line: number; message: string }>;
}

export const previewImport = (
  type: ImportType,
  csv: string,
): Promise<ImportPreview> =>
  requestJson<ImportPreview>("POST", "/api/import/preview", { type, csv });

export const confirmImport = (
  type: ImportType,
  csv: string,
): Promise<ImportResult> =>
  requestJson<ImportResult>("POST", "/api/import/confirm", { type, csv });

