/**
 * Deterministic demo dataset for "Aarav's Printing Studio" (small printing & design business).
 *
 * Story (as of 2025-06-15, 30-day horizon to 2025-07-15):
 * - Opening balance ₹1,04,000. Outflows in horizon total ≈ ₹1,54,000:
 *   studio rent ₹45,000 (1 Jul), ink & substrate restock ₹38,000 (27 Jun),
 *   equipment repair ₹18,000 (30 Jun), electricity ₹9,000 (20 Jun),
 *   equipment lease ₹12,000 (25 Jun), paper/ink supplier ₹8,000 weekly (18 Jun, 25 Jun, 2 Jul, 9 Jul).
 * - Sharma Textiles is the major customer. Its ₹60,000 invoice (INV-1047, due 16 May, 30 days overdue)
 *   has ₹50,000 already paid, leaving ₹10,000 open, collected at asOf+14 = 29 Jun. Its ₹75,000 invoice
 *   (INV-1049, due 30 Jun) is collected at due+10 = 10 Jul. Sharma ≈ ₹85,000 of ≈ ₹2,08,000 expected
 *   inflows in the horizon (~41%).
 * - Verma Boutique is repeatedly late (INV-1041, INV-1044 paid after due). Mehta Cafe and Khan Stationers
 *   are reliable. Iyer Events has a single invoice (insufficient history).
 * - Hand-estimated baseline (not run): balance falls to ≈ -₹40,000 on 9 Jul 2025 (first negative day 1 Jul, rent due;
 *   shortage ₹40,000; below the ₹50,000 buffer from ≈ 30 Jun). Inflows only arrive from 10 Jul, so the shortage is a timing gap.
 *
 * All simulated records carry isDemoData: true. Money is in paise (1 rupee = 100 paise).
 */
import type { Dataset } from "../../../shared/types.js";

export function buildSeedDataset(): Dataset {
  return {
    settings: {
      openingBalance: 10_400_000,
      safetyBuffer: 5_000_000,
      asOfDate: "2025-06-15",
      forecastHorizonDays: 30,
      defaultPaymentDelayDays: 10,
      overdueCollectionDelayDays: 14,
    },
    customers: [
      { id: "cust-sharma", name: "Sharma Textiles", email: "accounts@sharmatextiles.example", isDemoData: true },
      { id: "cust-verma", name: "Verma Boutique", phone: "+91-98100-00011", isDemoData: true },
      { id: "cust-mehta", name: "Mehta Cafe", isDemoData: true },
      { id: "cust-khan", name: "Khan Stationers", isDemoData: true },
      { id: "cust-desai", name: "Desai Schools", isDemoData: true },
      { id: "cust-iyer", name: "Iyer Events", isDemoData: true },
    ],
    invoices: [
      { id: "inv-1040", invoiceNumber: "INV-1040", customerId: "cust-mehta", issueDate: "2025-02-05", dueDate: "2025-02-20", amount: 2_000_000, status: "paid" },
      { id: "inv-1041", invoiceNumber: "INV-1041", customerId: "cust-verma", issueDate: "2025-02-01", dueDate: "2025-02-15", amount: 1_500_000, status: "paid" },
      { id: "inv-1042", invoiceNumber: "INV-1042", customerId: "cust-sharma", issueDate: "2025-03-10", dueDate: "2025-03-25", amount: 4_500_000, status: "paid" },
      { id: "inv-1043", invoiceNumber: "INV-1043", customerId: "cust-khan", issueDate: "2025-04-01", dueDate: "2025-04-15", amount: 2_200_000, status: "paid" },
      { id: "inv-1044", invoiceNumber: "INV-1044", customerId: "cust-verma", issueDate: "2025-04-10", dueDate: "2025-04-25", amount: 1_600_000, status: "paid" },
      { id: "inv-1045", invoiceNumber: "INV-1045", customerId: "cust-desai", issueDate: "2025-05-01", dueDate: "2025-05-15", amount: 3_000_000, status: "paid" },
      { id: "inv-1046", invoiceNumber: "INV-1046", customerId: "cust-mehta", issueDate: "2025-05-20", dueDate: "2025-06-04", amount: 2_500_000, status: "paid" },
      { id: "inv-1047", invoiceNumber: "INV-1047", customerId: "cust-sharma", issueDate: "2025-05-01", dueDate: "2025-05-16", amount: 6_000_000, status: "overdue" },
      { id: "inv-1048", invoiceNumber: "INV-1048", customerId: "cust-verma", issueDate: "2025-06-01", dueDate: "2025-06-15", amount: 1_000_000, status: "cancelled", cancelled: true, notes: "Order withdrawn by customer" },
      { id: "inv-1049", invoiceNumber: "INV-1049", customerId: "cust-sharma", issueDate: "2025-06-01", dueDate: "2025-06-30", amount: 7_500_000, status: "sent" },
      { id: "inv-1050", invoiceNumber: "INV-1050", customerId: "cust-mehta", issueDate: "2025-06-05", dueDate: "2025-07-01", amount: 3_500_000, status: "sent" },
      { id: "inv-1051", invoiceNumber: "INV-1051", customerId: "cust-khan", issueDate: "2025-06-03", dueDate: "2025-07-03", amount: 2_800_000, status: "sent" },
      { id: "inv-1052", invoiceNumber: "INV-1052", customerId: "cust-desai", issueDate: "2025-05-20", dueDate: "2025-07-04", amount: 4_000_000, status: "partially_paid" },
      { id: "inv-1053", invoiceNumber: "INV-1053", customerId: "cust-iyer", issueDate: "2025-06-02", dueDate: "2025-07-02", amount: 3_000_000, status: "sent" },
    ],
    payments: [
      { id: "pay-001", invoiceId: "inv-1040", date: "2025-02-18", amount: 2_000_000, isDemoData: true },
      { id: "pay-002", invoiceId: "inv-1041", date: "2025-03-04", amount: 1_500_000, isDemoData: true },
      { id: "pay-003", invoiceId: "inv-1042", date: "2025-03-20", amount: 2_500_000, isDemoData: true },
      { id: "pay-004", invoiceId: "inv-1042", date: "2025-04-08", amount: 2_000_000, isDemoData: true },
      { id: "pay-005", invoiceId: "inv-1043", date: "2025-04-12", amount: 2_200_000, isDemoData: true },
      { id: "pay-006", invoiceId: "inv-1044", date: "2025-05-09", amount: 1_600_000, isDemoData: true },
      { id: "pay-007", invoiceId: "inv-1045", date: "2025-05-14", amount: 3_000_000, isDemoData: true },
      { id: "pay-008", invoiceId: "inv-1046", date: "2025-06-03", amount: 2_500_000, isDemoData: true },
      { id: "pay-009", invoiceId: "inv-1047", date: "2025-05-30", amount: 5_000_000, isDemoData: true },
      { id: "pay-010", invoiceId: "inv-1052", date: "2025-06-02", amount: 1_000_000, isDemoData: true },
    ],
    expenses: [
      { id: "exp-001", name: "Studio rent", category: "rent", amount: 4_500_000, dueDate: "2025-07-01", recurrence: "monthly", isDemoData: true },
      { id: "exp-002", name: "Electricity", category: "utilities", amount: 900_000, dueDate: "2025-06-20", recurrence: "monthly", isDemoData: true },
      { id: "exp-003", name: "Equipment maintenance lease", category: "equipment", amount: 1_200_000, dueDate: "2025-06-25", recurrence: "monthly", isDemoData: true },
      { id: "exp-004", name: "Paper & ink supplier", category: "supplies", amount: 800_000, dueDate: "2025-06-18", recurrence: "weekly", isDemoData: true },
      { id: "exp-005", name: "Large ink & substrate restock", category: "supplies", amount: 3_800_000, dueDate: "2025-06-27", recurrence: "none", isDemoData: true },
      { id: "exp-006", name: "Equipment repair", category: "equipment", amount: 1_800_000, dueDate: "2025-06-30", recurrence: "none", isDemoData: true },
    ],
  };
}
