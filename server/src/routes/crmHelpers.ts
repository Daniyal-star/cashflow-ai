/**
 * Shared HTTP and id helpers for the Milestone 3 CRM routes (customers, invoices, payments).
 */

import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { ZodError } from "zod";
import { formatZodError } from "../validation/crmSchemas.js";

/** "<prefix>-" + 8 hex-ish chars from randomUUID. */
export function newId(prefix: "cust" | "inv" | "pay"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Plain code-unit comparison for deterministic sorting. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 400 response with the flattened message and the raw Zod issues. */
export function sendValidationError(res: Response, err: ZodError): void {
  res.status(400).json({ error: formatZodError(err), issues: err.issues });
}

/** Wrap a synchronous handler so unexpected failures (e.g. store write errors) return 500 { error }. */
export function guard(handler: (req: Request, res: Response) => void): RequestHandler {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}
