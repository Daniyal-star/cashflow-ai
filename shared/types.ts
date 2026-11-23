/**
 * CASHFLOW AI shared domain types.
 *
 * Money convention: ALL money values are integer minor units (paise).
 * Never store or compute money as floating-point rupees.
 *
 * Date convention: ALL dates are ISO date-only strings "YYYY-MM-DD".
 */

export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

export type RecurrenceFrequency = "none" | "weekly" | "monthly";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  isDemoData: boolean;
}

/** `amount` is in paise. `status` is stored, but forecasts must derive remaining balance from payments. */
export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  status: InvoiceStatus;
  cancelled?: boolean;
  notes?: string;
}

/** `amount` is in paise. */
export interface Payment {
  id: string;
  invoiceId: string;
  date: string;
  amount: number;
  isDemoData: boolean;
}

/** `amount` is in paise. */
export interface Expense {
  id: string;
  name: string;
  category: string;
  amount: number;
  dueDate: string;
  recurrence: RecurrenceFrequency;
  recurrenceEndDate?: string;
  isDemoData: boolean;
}

/** Money fields are in paise. `overdueCollectionDelayDays` = assumed days from as-of date until an overdue invoice is collected. */
export interface Settings {
  openingBalance: number;
  safetyBuffer: number;
  asOfDate: string;
  forecastHorizonDays: number;
  defaultPaymentDelayDays: number;
  overdueCollectionDelayDays: number;
}

/** Discriminated union on `type`. Money fields are in paise. */
export type ScenarioAdjustment =
  | { type: "customer_delay"; customerId: string; days: number }
  | { type: "customer_partial_payment"; customerId: string; amount: number; expectedDate: string }
  | { type: "customer_early_payment"; customerId: string; days: number }
  | { type: "new_expense"; name: string; amount: number; date: string; recurrence: RecurrenceFrequency }
  | { type: "expense_increase"; expenseId: string; percent: number }
  | { type: "expense_postponement"; expenseId: string; days: number; occurrenceDate?: string }
  | { type: "rent_increase"; expenseId: string; percent: number }
  | { type: "supplier_payment_change"; expenseId: string; amount: number }
  | { type: "invoice_delay"; invoiceId: string; days: number };

export interface Dataset {
  settings: Settings;
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  /** Optional for backward compatibility with datasets saved before Milestone 7.1. Treat missing as []. */
  reminders?: ReminderRecord[];
}

/* ---------- Forecast types ---------- */

/** Money fields are in paise. */
export interface ForecastDay {
  date: string;
  incoming: number;
  outgoing: number;
  balance: number;
}

/** Money fields are in paise. */
export interface ForecastResult {
  asOfDate: string;
  horizonDays: number;
  openingBalance: number;
  safetyBuffer: number;
  days: ForecastDay[];
  minimumBalance: number;
  minimumBalanceDate: string;
  shortageDate: string | null;
  shortageAmount: number;
  cashRunwayDays: number;
  riskLevel: RiskLevel;
  bufferStatus: "above_buffer" | "below_buffer" | "negative";
  assumptions: string[];
  warnings: string[];
}

/* ---------- Risk types ---------- */

/** `metrics` values may include paise amounts. */
export interface RiskFinding {
  id: string;
  severity: RiskSeverity;
  category: "cash" | "receivable" | "concentration" | "expense";
  title: string;
  explanation: string;
  metrics: Record<string, number | string | null>;
  recommendedAction: string;
}

/* ---------- Scenario types ---------- */

/** Balance and shortage amounts are in paise; runway is in days. */
export interface ScenarioComparison {
  baseline: ForecastResult;
  scenario: ForecastResult;
  balanceDifference: number;
  minimumBalanceDifference: number;
  shortageDateBefore: string | null;
  shortageDateAfter: string | null;
  shortageAmountBefore: number;
  shortageAmountAfter: number;
  riskLevelBefore: RiskLevel;
  riskLevelAfter: RiskLevel;
  runwayDaysBefore: number;
  runwayDaysAfter: number;
}

/* ---------- Dashboard types ---------- */

/** Money fields are in paise. `asOfDate` and dates are "YYYY-MM-DD". */
export interface DashboardResponse {
  asOfDate: string;
  kpis: {
    availableCash: number;
    outstandingReceivables: number;
    overdueReceivables: number;
    upcomingExpenses: number;
    expectedInflows: number;
    projectedMinimumBalance: number;
    minimumBalanceDate: string;
    cashRunwayDays: number;
    shortageDate: string | null;
    shortageAmount: number;
    safetyBuffer: number;
    riskLevel: RiskLevel;
  };
  forecast: ForecastResult;
  risks: RiskFinding[];
  collectionPriorities: Array<{
    customerId: string;
    customerName: string;
    outstanding: number;
    overdueAmount: number;
    maxDaysOverdue: number;
    invoiceCount: number;
  }>;
}


/* ---------- Milestone 3: CRM types ---------- */

/** Money fields are in paise. `paidAmount` sums all payments; `balance` = max(0, amount - paidAmount). */
export interface InvoiceView extends Invoice {
  paidAmount: number;
  balance: number;
  daysOverdue: number;
}

/** Money fields are in paise. */
export interface CustomerView extends Customer {
  invoiceCount: number;
  outstanding: number;
  overdueAmount: number;
}

/** `amount` is in paise. */
export interface PaymentInput {
  date: string;
  amount: number;
}

/** `amount` is in paise. */
export interface InvoiceInput {
  invoiceNumber: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  notes?: string;
  cancelled?: boolean;
}

export interface CustomerInput {
  name: string;
  email?: string;
  phone?: string;
}


/* ---------- Milestone 5: Customer Intelligence types ---------- */

export type CustomerClassification = "reliable" | "occasionally_late" | "consistently_late" | "insufficient_data";

/** Money fields are in paise. Delay is in days (negative = paid early). */
export interface CustomerIntelligence {
  customerId: string;
  customerName: string;
  classification: CustomerClassification;
  reliabilityScore: number | null;
  reliabilityExplanation: string;
  settledInvoiceCount: number;
  onTimeRatio: number | null;
  averagePaymentDelayDays: number | null;
  outstanding: number;
  overdueAmount: number;
  maxDaysOverdue: number;
  concentrationShare: number;
  concentrationFlag: boolean;
  riskLevel: RiskLevel;
  riskRank: number;
  riskReasons: string[];
}


/* ---------- Milestone 6: AI CFO types ---------- */

export type ActionUrgency = "now" | "this_week" | "this_month";

export type AiCfoSource = "ai" | "deterministic";

export type AiCfoProviderStatus = "not_configured" | "ok" | "unavailable" | "invalid_output";

/** Money fields are in paise. `coverageShare` is the fraction (0..1) of the shortage this action addresses, or null. */
export interface AiCfoAction {
  id: string;
  rank: number;
  title: string;
  detail: string;
  urgency: ActionUrgency;
  expectedImpact: number;
  coverageShare: number | null;
}

export interface AiCfoRiskItem {
  riskId: string;
  severity: RiskSeverity;
  title: string;
  explanation: string;
  consequence: string;
  urgency: ActionUrgency;
}

/** Balance and shortage amounts are in paise; runway is in days. */
export interface AiCfoScenarioAdvice {
  summary: string;
  shortageDateBefore: string | null;
  shortageDateAfter: string | null;
  minimumBalanceBefore: number;
  minimumBalanceAfter: number;
  riskLevelBefore: RiskLevel;
  riskLevelAfter: RiskLevel;
  actionHint: string;
}

/** Money fields are in paise. `asOfDate` and dates are "YYYY-MM-DD". */
export interface AiCfoBriefing {
  asOfDate: string;
  source: AiCfoSource;
  providerStatus: AiCfoProviderStatus;
  summary: string;
  metrics: {
    availableCash: number;
    outstandingReceivables: number;
    overdueReceivables: number;
    upcomingExpenses: number;
    expectedInflows: number;
    projectedMinimumBalance: number;
    minimumBalanceDate: string;
    shortageDate: string | null;
    shortageAmount: number;
    cashRunwayDays: number;
    safetyBuffer: number;
    riskLevel: RiskLevel;
  };
  risks: AiCfoRiskItem[];
  actions: AiCfoAction[];
  scenario: AiCfoScenarioAdvice | null;
}


/* ---------- Milestone 6.1: AI CFO chat types ---------- */

export type AiCfoChatBasis = "actual" | "forecast" | "scenario" | "mixed";

export interface AiCfoChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCfoChatRequest {
  message: string;
  history?: AiCfoChatMessage[];
  adjustments?: ScenarioAdjustment[];
}

export interface AiCfoChatResponse {
  answer: string;
  source: AiCfoSource;
  providerStatus: AiCfoProviderStatus;
  basis: AiCfoChatBasis;
  intent:
    | "cash_position"
    | "shortage"
    | "today_actions"
    | "collection_priority"
    | "customer_risk"
    | "scenario"
    | "expense_affordability"
    | "prevention"
    | "general"
    | "forecast"
    | "receivables";
  facts: string[];
}


/* ---------- Milestone 7: Smart Collections types ---------- */

export type CollectionPriority = "critical" | "high" | "medium" | "low";

/** Money fields are in paise. `dueDate` is "YYYY-MM-DD". `reliabilityScore` is null when history is insufficient. */
export interface CollectionQueueItem {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  dueDate: string;
  amount: number;
  balance: number;
  overdueAmount: number;
  daysOverdue: number;
  reliabilityScore: number | null;
  classification: CustomerClassification;
  priority: CollectionPriority;
  priorityRank: number;
  reasons: string[];
}

/** Money fields are in paise. `asOfDate` is "YYYY-MM-DD". */
export interface CollectionsSummary {
  asOfDate: string;
  totalOutstanding: number;
  totalOverdue: number;
  overdueInvoiceCount: number;
  customersRequiringAttention: number;
  opportunityCount: number;
  queue: CollectionQueueItem[];
}

export type ReminderTone = "friendly" | "professional" | "firm";

export type ReminderChannel = "whatsapp" | "email";

/** Money fields are in paise. `date` and `sentAt` are "YYYY-MM-DD". `balanceAtDraft` is the open balance when the reminder was recorded. */
export interface ReminderRecord {
  id: string;
  invoiceId: string;
  customerId: string;
  tone: ReminderTone;
  date: string;
  balanceAtDraft: number;
  status: "drafted" | "sent";
  sentAt?: string;
  channels: ReminderChannel[];
  isDemoData: false;
}


