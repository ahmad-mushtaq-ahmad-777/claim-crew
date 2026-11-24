import type { ClaimTypeId, ReaderResult } from "@/lib/claim-types";

// Everything that differs between claim types lives here, so the Reader,
// Auditor, Form Filler and Dispatcher all run the same code with a different config.
// Pure data only: it is imported by both the server and the browser.

export const FIELD_LABELS: Record<string, string> = {
  beneficiary: "Beneficiary",
  serviceProvider: "Service Provider",
  date: "Date",
  month: "Month",
  natureOfExpense: "Nature of Expense",
  amount: "Amount",
  healthClub: "Health Club",
};

export type ClaimConfig = {
  id: ClaimTypeId;
  // Short name used in messages, e.g. "internet bill".
  label: string;
  // What the Reader is told it is looking at.
  documentName: string;
  // Title of the form the Form Filler draws.
  formName: string;
  // Fields the Reader extracts, in display order.
  fields: readonly string[];
  // Fields that must be read reliably before a claim can be judged.
  required: readonly string[];
  // One instruction line per field for the Reader prompt.
  fieldHints: Record<string, string>;
  // Auditor: does this receipt belong to this claim type?
  expense: {
    checkLabel: string; // e.g. "Expense is an internet bill"
    failName: string; // e.g. "an internet bill"
    keywords: readonly string[];
    // Fields searched for the keywords.
    textFields: readonly string[];
  };
  // Share of the amount Accounts reimburses (1 = all of it).
  reimbursementRate: number;
  // Monthly limit on the reimbursable amount. The form still shows full amounts,
  // so going over is only noted by the Auditor and never blocks the claim.
  monthlyCap: number;
  // Canned values used when MOCK_LLM is on.
  mockFields: ReaderResult;
};

// The reimbursable share of an amount, rounded to 2 decimals. Plain code, never a model guess.
export function reimbursableAmount(amount: number, config: ClaimConfig): number {
  return Math.round(amount * config.reimbursementRate * 100) / 100;
}

const internet: ClaimConfig = {
  id: "internet",
  label: "internet bill",
  documentName: "internet bill receipt",
  formName: "Internet Expense Sheet",
  fields: [
    "beneficiary",
    "serviceProvider",
    "date",
    "month",
    "natureOfExpense",
    "amount",
  ],
  required: ["beneficiary", "serviceProvider", "date", "month", "natureOfExpense", "amount"],
  fieldHints: {
    beneficiary: "the customer / account holder name on the bill",
    serviceProvider: "the company that issued the bill",
    date: "the bill or payment date, formatted YYYY-MM-DD",
    month:
      'the billing month as the full month name only, e.g. "November" (no year). Use the billing period if the bill states one; if none is printed, use the month of the bill date with a lower confidence (about 0.75)',
    natureOfExpense: 'short description, e.g. "Internet bill"',
    amount: "the total amount payable as a number, no currency symbol",
  },
  expense: {
    checkLabel: "Expense is an internet bill",
    failName: "an internet bill",
    keywords: [
      "internet",
      "broadband",
      "wifi",
      "wi-fi",
      "fiber",
      "fibre",
      "data",
      "package",
      "dsl",
    ],
    textFields: ["natureOfExpense", "serviceProvider"],
  },
  reimbursementRate: 1,
  monthlyCap: 2000,
  mockFields: {
    beneficiary: { value: "Jane Doe", confidence: 0.95 },
    serviceProvider: { value: "Example ISP", confidence: 0.97 },
    date: { value: "2026-11-05", confidence: 0.93 },
    month: { value: "November", confidence: 0.9 },
    natureOfExpense: { value: "Internet bill", confidence: 0.96 },
    amount: { value: 4500, confidence: 0.98 },
  },
};

const gym: ClaimConfig = {
  id: "gym",
  label: "health club receipt",
  documentName: "health club (gym) membership payment receipt",
  formName: "Health Club Expense Sheet",
  fields: ["beneficiary", "date", "month", "healthClub", "amount"],
  required: ["beneficiary", "date", "month", "healthClub", "amount"],
  fieldHints: {
    beneficiary: "the member name on the receipt",
    date: "the payment or receipt date, formatted YYYY-MM-DD",
    month:
      'the membership month the dues are for, as the full month name only, e.g. "November" (no year). Use the membership period if the receipt states one; if none is printed, use the month of the payment date with a lower confidence (about 0.75)',
    healthClub: "the name of the gym / health club that issued the receipt",
    amount: "the total membership dues paid as a number, no currency symbol",
  },
  expense: {
    checkLabel: "Expense is a health club membership",
    failName: "a health club membership",
    keywords: [
      "gym",
      "fitness",
      "health",
      "club",
      "sport",
      "workout",
      "crossfit",
      "yoga",
      "pilates",
      "wellness",
      "athletic",
      "membership",
    ],
    textFields: ["healthClub"],
  },
  reimbursementRate: 0.6,
  monthlyCap: 4000,
  mockFields: {
    beneficiary: { value: "Jane Doe", confidence: 0.95 },
    date: { value: "2026-11-05", confidence: 0.93 },
    month: { value: "November", confidence: 0.9 },
    healthClub: { value: "Example Fitness Club", confidence: 0.96 },
    amount: { value: 6000, confidence: 0.98 },
  },
};

export const CLAIM_CONFIGS: Record<ClaimTypeId, ClaimConfig> = { internet, gym };

