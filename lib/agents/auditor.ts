import type {
  AuditCheck,
  AuditResult,
  AuditVerdict,
  ReaderResult,
  ReceiptFieldName,
} from "@/lib/claim-types";
import { FIELD_LABELS, reimbursableAmount, type ClaimConfig } from "@/lib/claim-configs";
import { isMockMode } from "@/lib/llm";
import { AUDIT_INFO_TOOLS, AUDIT_TOOLS, type AuditToolContext } from "@/lib/tools/audit-tools";
import { runToolAgent } from "@/lib/tools/tool-agent";
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

// Says exactly what is wrong: a field that was not found at all, or one read with low confidence.
function confidenceDetail(fields: ReaderResult, lowFields: ReceiptFieldName[]): string {
  const notFound = lowFields.filter((f) => fields[f].value === null);
  const unsure = lowFields.filter((f) => fields[f].value !== null);
  const parts: string[] = [];
  if (notFound.length > 0) {
    parts.push(`Not found on the receipt: ${notFound.map(labelOf).join(", ")}.`);
  }
  if (unsure.length > 0) {
    parts.push(`Read with low confidence: ${unsure.map(labelOf).join(", ")}.`);
  }
  return parts.join(" ");
}

// Rule checks are plain code so the verdict is always consistent and explainable.
function runChecks(fields: ReaderResult, config: ClaimConfig, today: Date) {
  const lowFields = config.required.filter(
    (f) =>
      fields[f].value === null ||
      fields[f].confidence < (POLICY.minConfidenceByField[f] ?? POLICY.minConfidence),
  );

  const confidence: AuditCheck = {
    id: "confidence",
    label: "Receipt was read clearly",
    passed: lowFields.length === 0,
    detail:
      lowFields.length === 0
        ? "All required fields were read with enough confidence."
        : confidenceDetail(fields, lowFields),
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
        ? `Invoice amount Rs. ${amountValue.toLocaleString("en-US")} will be written on the form in full.`
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
        ? `Reimbursable amount Rs. ${reimbursable.toLocaleString("en-US")} is over the monthly cap of Rs. ${config.monthlyCap.toLocaleString("en-US")}. Full amounts are written on the form and Accounts will apply the cap.`
        : `Reimbursable amount Rs. ${reimbursable.toLocaleString("en-US")} is within the monthly cap of Rs. ${config.monthlyCap.toLocaleString("en-US")}.`,
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

// Auditor: a tool-calling agent. It first calls run_policy_checks (plain code, results go back
// to the model), then decides what to do by calling one tool: approve, re-read or reject.
// The tools enforce the hard rules, so the model can never approve a claim with a failed check.
export async function runAuditor(
  fields: ReaderResult,
  config: ClaimConfig,
  // How many more re-reads the Reader may do. At 0 this is the final pass.
  retriesLeft: number = POLICY.maxRetries,
  today: Date = new Date(),
): Promise<AuditResult> {
  // Mock mode runs without any model, so use the rule-based verdict directly.
  if (isMockMode()) {
    const { checks, lowFields } = runChecks(fields, config, today);
    const ruled = decideVerdict(checks, lowFields);
    const outOfRetries = ruled === "needs_reread" && retriesLeft <= 0;
    const verdict = outOfRetries ? "rejected" : ruled;
    const action =
      verdict === "approved"
        ? { name: "approve_claim", arguments: {} }
        : verdict === "needs_reread"
          ? { name: "request_reread", arguments: { fields: lowFields } }
          : { name: "reject_claim", arguments: {} };
    return {
      agent: "auditor",
      verdict,
      checks,
      reason: outOfRetries
        ? `${templatedReason("needs_reread", checks)} Re-reads were tried ${POLICY.maxRetries} times without success, so the claim is rejected.`
        : templatedReason(verdict, checks),
      rereadFields: verdict === "needs_reread" ? lowFields : [],
      toolCall: action,
      toolCalls: [{ name: "run_policy_checks", arguments: {} }, action],
    };
  }

  const ctx: AuditToolContext = {
    config,
    retriesLeft,
    evaluate: () => runChecks(fields, config, today),
  };
  const { result, toolCall, toolCalls } = await runToolAgent({
    system:
      "You are the Auditor agent in an expense-claim system. " +
      "First call run_policy_checks. Its results are your evidence. Then decide the outcome by calling exactly one of the other tools; do not answer with text. " +
      "If every check passed, call approve_claim (mention any check marked note briefly). " +
      "If a required field is unclear or missing and retriesLeft is above 0, a second look often fixes it, so call request_reread. If retriesLeft is 0, re-reads are used up: call reject_claim and say that re-reads were tried without success. A check that failed only because a field was unclear or missing is not a policy violation. " +
      "Call reject_claim when a policy check failed on a field that was read clearly (wrong year, wrong expense type, no valid amount), or when the receipt is clearly unusable. " +
      "Use only facts from the checks. Amounts are in Pakistani rupees: write them as Rs. followed by the number, exactly as given in the checks. Do not invent facts or policy.",
    request: { kind: "audit", claimType: config.id },
    tools: AUDIT_TOOLS,
    infoTools: AUDIT_INFO_TOOLS,
    requireFirst: "run_policy_checks",
    ctx,
    failurePrefix: "The Auditor could not reach a decision",
  });

  return {
    agent: "auditor",
    verdict: result.verdict,
    checks: ctx.evaluation!.checks,
    reason: result.reason,
    rereadFields: result.rereadFields,
    toolCall,
    toolCalls,
  };
}
