/**
 * Integration boundary for a future payment-prediction model (Milestone 7).
 *
 * Types and a no-op source only. No prediction is computed or used here: the chat accepts a
 * PaymentPredictionSource but does not read it in any answer yet, so passing one cannot change an answer.
 */

import type { Dataset } from "../../../shared/types.js";

export interface CustomerPaymentPrediction {
  customerId: string;
  /** Predicted days late against the due date, or null when the model has no estimate. */
  expectedDelayDays: number | null;
  /** Probability (0..1) that the invoice is paid late, or null when unknown. */
  lateProbability: number | null;
  modelId: string;
}

export type PaymentPredictionSource = (dataset: Dataset) => CustomerPaymentPrediction[];

/** Default source: no predictions. */
export const noPaymentPredictions: PaymentPredictionSource = () => [];
