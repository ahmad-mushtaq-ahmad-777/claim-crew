import type {
  AuditCheck,
  AuditResult,
  AuditVerdict,
  ReaderResult,
  ReceiptFieldName,
} from "@/lib/claim-types";
import { chatCompletion, isMockMode } from "@/lib/llm";
import { POLICY } from "@/lib/policy";

// Fields that must be read reliably before a claim can be judged.
const REQUIRED_FIELDS: ReceiptFieldName[] = [
  "beneficiary",
  "serviceProvider",
  "date",
  "natureOfExpense",
  "amount",
];

const INTERNET_KEYWORDS = [
  "internet",
  "broadband",
  "wifi",
  "wi-fi",
  "fiber",
  "fibre",
  "data",
  "package",
  "dsl",
];

const FIELD_LABELS: Record<ReceiptFieldName, string> = {
  beneficiary: "beneficiary",
  serviceProvider: "service provider",
  date: "date",
  month: "month",
  natureOfExpense: "nature of expense",
  amount: "amount",
};

function yearOf(value: string | number | null): number | null {
  if (value === null) return null;
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function looksLikeInternetBill(fields: ReaderResult): boolean {
  const text = `${fields.natureOfExpense.value ?? ""} ${fields.serviceProvider.value ?? ""}`.toLowerCase();
  return INTERNET_KEYWORDS.some((k) => text.includes(k));
}

// Rule checks are plain code so the verdict is always consistent and explainable.
function runChecks(fields: ReaderResult, today: Date) {
  const lowFields = REQUIRED_FIELDS.filter(
    (f) =>
      fields[f].value === null || fields[f].confidence < POLICY.minConfidence,
  );

  const confidence: AuditCheck = {
    id: "confidence",
    label: "Receipt was read clearly",
    passed: lowFields.length === 0,
    detail:
      lowFields.length === 0
        ? "All required fields were read with enough confidence."
        : `Unclear or missing: ${lowFields.map((f) => FIELD_LABELS[f]).join(", ")}.`,
  };

  const receiptYear = yearOf(fields.date.value);
  const currentYear = today.getFullYear();
  const year: AuditCheck = {
    id: "year",
    label: "Receipt is from the current year",
    passed: receiptYear === currentYear,
    detail:
      receiptYear === null
        ? "No year could be determined from the receipt date."
        : receiptYear === currentYear
          ? `Receipt year ${receiptYear} matches the current year.`
          : `Receipt year ${receiptYear} is not the current year (${currentYear}).`,
  };

  const expenseType: AuditCheck = {
    id: "expenseType",
    label: "Expense is an internet bill",
    passed: looksLikeInternetBill(fields),
    detail: looksLikeInternetBill(fields)
      ? `"${fields.natureOfExpense.value}" from ${fields.serviceProvider.value} qualifies.`
      : `"${fields.natureOfExpense.value ?? "unknown"}" is not an internet bill.`,
  };

  const amountValue = fields.amount.value;
  const amount: AuditCheck = {
    id: "amount",
    label: "Amount is valid",
    passed: typeof amountValue === "number" && amountValue > 0,
    detail:
      typeof amountValue === "number" && amountValue > 0
        ? `Invoice amount ${amountValue} will be written on the form in full.`
        : "No valid amount was found on the receipt.",
  };

  return { checks: [confidence, year, expenseType, amount], lowFields };
}

function decideVerdict(
  checks: AuditCheck[],
  lowFields: ReceiptFieldName[],
): AuditVerdict {
  if (lowFields.length > 0) return "needs_reread";
  return checks.every((c) => c.passed) ? "approved" : "rejected";
}

function templatedReason(verdict: AuditVerdict, checks: AuditCheck[]): string {
  if (verdict === "approved") {
    return "All checks passed. This claim is ready to be filled in and sent to Accounts.";
  }
  const failed = checks.filter((c) => !c.passed).map((c) => c.detail);
  if (verdict === "needs_reread") {
    return `The receipt needs another look. ${failed.join(" ")}`;
  }
  return `This claim was rejected. ${failed.join(" ")}`;
}

// The model turns the check results into a short, friendly explanation.
async function writeReason(
  verdict: AuditVerdict,
  checks: AuditCheck[],
): Promise<string> {
  const fallback = templatedReason(verdict, checks);
  if (isMockMode()) return fallback;
  try {
    const completion = await chatCompletion(
      {
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are the Auditor agent in an expense-claim system. Given the verdict and check results, write 1-2 plain sentences for the employee explaining the outcome. If rejected, state the exact reason and what they could do. Do not invent facts or policy.",
          },
          { role: "user", content: JSON.stringify({ verdict, checks }) },
        ],
      },
      // The reason is a nice-to-have, so give up quickly and use the template.
      { timeout: 15_000, maxModels: 1 },
    );
    return completion.choices[0]?.message?.content?.trim() || fallback;
  } catch (e) {
    console.error("Auditor reason failed, using template:", e);
    return fallback;
  }
}

export async function runAuditor(
  fields: ReaderResult,
  today: Date = new Date(),
): Promise<AuditResult> {
  const { checks, lowFields } = runChecks(fields, today);
  const verdict = decideVerdict(checks, lowFields);
  return {
    agent: "auditor",
    verdict,
    checks,
    reason: await writeReason(verdict, checks),
    rereadFields: verdict === "needs_reread" ? lowFields : [],
  };
}
