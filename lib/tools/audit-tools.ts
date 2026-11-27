import type { ClaimConfig } from "@/lib/claim-configs";
import type { AuditCheck, AuditVerdict, ReceiptFieldName } from "@/lib/claim-types";
import type { AgentTool, InfoTool } from "@/lib/tools/tool-agent";

// Tools of the Auditor agent. The model first calls run_policy_checks (the checks are plain
// code) and then decides what to do about the results by calling one action tool.
// Each tool enforces the hard rules, so the model can never approve a claim with a failed
// check or ask for a re-read of a field that is not part of the form.
// The result of running the policy checks.
export type PolicyEvaluation = {
  checks: AuditCheck[];
  // Required fields that were missing or read with low confidence.
  lowFields: ReceiptFieldName[];
};

export type AuditToolContext = {
  config: ClaimConfig;
  // How many more re-reads are allowed. At 0 the Auditor must decide: approve or reject.
  retriesLeft: number;
  // Runs the rule-based checks (plain code).
  evaluate: () => PolicyEvaluation;
  // Filled in when the model calls run_policy_checks. The action tools need it.
  evaluation?: PolicyEvaluation;
};

export type AuditAction = {
  verdict: AuditVerdict;
  reason: string;
  rereadFields: ReceiptFieldName[];
};

export type AuditTool = AgentTool<AuditToolContext, AuditAction> & { kind: "audit" };

function reasonOf(args: unknown, toolName: string): string {
  const reason = (args as { reason?: unknown } | null)?.reason;
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(`${toolName} needs a short reason for the employee`);
  }
  return reason.trim().slice(0, 400);
}

const REASON_PARAM = {
  type: "string",
  description:
    "1-2 plain sentences for the employee explaining the outcome. Use only facts from the checks. Write amounts as Rs. followed by the number.",
};

function evaluationOf(ctx: AuditToolContext, toolName: string): PolicyEvaluation {
  if (!ctx.evaluation) throw new Error(`${toolName} needs run_policy_checks to be called first`);
  return ctx.evaluation;
}

export const runPolicyChecks: InfoTool<AuditToolContext> = {
  name: "run_policy_checks",
  description:
    "Runs the company policy checks on the extracted claim (receipt read clearly, current year, expense type, valid amount, monthly cap) and returns the results. Always call this first; the results are your evidence for the decision.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    ctx.evaluation ??= ctx.evaluate();
    const { checks, lowFields } = ctx.evaluation;
    return {
      checks,
      unclearOrMissingFields: lowFields,
      requiredFields: ctx.config.required,
      retriesLeft: ctx.retriesLeft,
    };
  },
};

const approveClaim: AuditTool = {
  name: "approve_claim",
  kind: "audit",
  description:
    "Approve the claim so the form can be filled in. Only valid when every check passed and no required field is unclear or missing. A check marked note is a heads-up that does not block approval; mention it briefly.",
  parameters: {
    type: "object",
    properties: { reason: REASON_PARAM },
    required: ["reason"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { checks, lowFields } = evaluationOf(ctx, "approve_claim");
    if (lowFields.length > 0 || checks.some((c) => !c.passed)) {
      throw new Error("approve_claim is not allowed while a check has failed");
    }
    return { verdict: "approved", reason: reasonOf(args, "approve_claim"), rereadFields: [] };
  },
};

const requestReread: AuditTool = {
  name: "request_reread",
  kind: "audit",
  description:
    "Send the receipt back to the Reader to read again. Use it when required fields are missing or unclear and a second look might fix them, and only while re-reads are left (retriesLeft above 0). List every field to re-read: all unclear or missing fields, plus any other required field you do not trust.",
  parameters: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Names of the fields the Reader should re-read.",
      },
      reason: REASON_PARAM,
    },
    required: ["fields", "reason"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { config, retriesLeft } = ctx;
    const { lowFields } = evaluationOf(ctx, "request_reread");
    if (retriesLeft <= 0) {
      throw new Error("request_reread is not allowed: no re-reads are left, so the claim must be rejected");
    }
    if (lowFields.length === 0) {
      throw new Error("request_reread is not allowed when every field was read clearly");
    }
    const raw = (args as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(raw) || !raw.every((f) => typeof f === "string")) {
      throw new Error("request_reread needs a list of field names");
    }
    const unknown = raw.filter((f) => !config.required.includes(f));
    if (unknown.length > 0) {
      throw new Error(`request_reread named fields that are not on the form: ${unknown.join(", ")}`);
    }
    const missing = lowFields.filter((f) => !raw.includes(f));
    if (missing.length > 0) {
      throw new Error(`request_reread must include every unclear field: ${missing.join(", ")}`);
    }
    return {
      verdict: "needs_reread",
      reason: reasonOf(args, "request_reread"),
      rereadFields: [...new Set(raw)],
    };
  },
};

const rejectClaim: AuditTool = {
  name: "reject_claim",
  kind: "audit",
  description:
    "Reject the claim. Use it when a policy check failed (wrong year, wrong expense type, no valid amount) or when the receipt is clearly unusable and reading it again would not help, or when fields are still unclear and no re-reads are left. Not allowed when every check passed.",
  parameters: {
    type: "object",
    properties: { reason: REASON_PARAM },
    required: ["reason"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { checks, lowFields } = evaluationOf(ctx, "reject_claim");
    if (lowFields.length === 0 && checks.every((c) => c.passed)) {
      throw new Error("reject_claim is not allowed when every check passed");
    }
    return { verdict: "rejected", reason: reasonOf(args, "reject_claim"), rereadFields: [] };
  },
};

export const AUDIT_TOOLS: AuditTool[] = [approveClaim, requestReread, rejectClaim];
export const AUDIT_INFO_TOOLS: InfoTool<AuditToolContext>[] = [runPolicyChecks];
