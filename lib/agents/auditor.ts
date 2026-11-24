import type {
  AuditCheck,
  AuditResult,
  AuditVerdict,
  ReaderResult,
  ReceiptFieldName,
} from "@/lib/claim-types";
import { FIELD_LABELS, reimbursableAmount, type ClaimConfig } from "@/lib/claim-configs";
import { chatCompletion, isMockMode } from "@/lib/llm";
import { POLICY } from "@/lib/policy";

const labelOf = (f: string) => (FIELD_LABELS[f] ?? f).toLowerCase();

function yearOf(value: string | number | null): number | null {
  if (value === null) return null;
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function matchesExpenseType(fields: ReaderResult, config: ClaimConfig): boolean {
  const text = config.expense.textFields
    .map((f) => String(fields[f]?.value ?? ""))
    .join(" ")
    .toLowerCase();
  return config.expense.keywords.some((k) => text.includes(k));
}

// Rule checks are plain code so the verdict is always consistent and explainable.
function runChecks(fields: ReaderResult, config: ClaimConfig, today: Date) {
  const lowFields = config.required.filter(
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
        : `Unclear or missing: ${lowFields.map(labelOf).join(", ")}.`,
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

  const shown = config.expense.textFields
    .map((f) => fields[f]?.value)
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(", ");
  const expenseType: AuditCheck = {
    id: "expenseType",
    label: config.expense.checkLabel,
    passed: matchesExpenseType(fields, config),
    detail: matchesExpenseType(fields, config)
      ? `"${shown}" qualifies as ${config.expense.failName}.`
      : `"${shown || "unknown"}" is not ${config.expense.failName}.`,
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

  // The cap never blocks a claim: full amounts go on the form and Accounts applies the cap.
  const checks = [confidence, year, expenseType, amount];
  if (typeof amountValue === "number" && amountValue > 0) {
    const reimbursable = reimbursableAmount(amountValue, config);
    const over = reimbursable > config.monthlyCap;
    checks.push({
      id: "cap",
      label: over ? "Over the monthly cap (note)" : "Within the monthly cap",
      passed: true,
      note: over,
      detail: over
        ? `Reimbursable amount ${reimbursable.toLocaleString("en-US")} is over the monthly cap of ${config.monthlyCap.toLocaleString("en-US")}. Full amounts are written on the form and Accounts will apply the cap.`
        : `Reimbursable amount ${reimbursable.toLocaleString("en-US")} is within the monthly cap of ${config.monthlyCap.toLocaleString("en-US")}.`,
    });
  }

  return { checks, lowFields };
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
    const capNote = checks.find((c) => c.note)?.detail;
    return `All checks passed. This claim is ready to be filled in and sent to Accounts.${capNote ? ` Note: ${capNote}` : ""}`;
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
              "You are the Auditor agent in an expense-claim system. Given the verdict and check results, write 1-2 plain sentences for the employee explaining the outcome. If rejected, state the exact reason and what they could do. If a check has note: true, it is a heads-up that does not block the claim, so mention it briefly. Do not invent facts or policy.",
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
  config: ClaimConfig,
  today: Date = new Date(),
): Promise<AuditResult> {
  const { checks, lowFields } = runChecks(fields, config, today);
  const verdict = decideVerdict(checks, lowFields);
  return {
    agent: "auditor",
    verdict,
    checks,
    reason: await writeReason(verdict, checks),
    rereadFields: verdict === "needs_reread" ? lowFields : [],
  };
}
