// Fields the internet reimbursement form needs from a receipt.
// "Number", signatures and approvals are intentionally NOT extracted.
export const RECEIPT_FIELDS = [
  "beneficiary",
  "serviceProvider",
  "date",
  "month",
  "natureOfExpense",
  "amount",
] as const;

export type ReceiptFieldName = (typeof RECEIPT_FIELDS)[number];

export type ExtractedField = {
  // null when the field could not be found on the receipt
  value: string | number | null;
  // 0 to 1: how sure the Reader is about this value
  confidence: number;
};

export type ReaderResult = Record<ReceiptFieldName, ExtractedField>;

// ---- Auditor ----

export type AuditCheck = {
  id: "year" | "expenseType" | "amount" | "confidence";
  label: string;
  passed: boolean;
  detail: string;
};

export type AuditVerdict = "approved" | "rejected" | "needs_reread";

export type AuditResult = {
  agent: "auditor";
  verdict: AuditVerdict;
  checks: AuditCheck[];
  // Plain-language explanation shown to the user, especially for rejections.
  reason: string;
  // Fields the Auditor wants the Reader to re-read (when verdict is needs_reread).
  rereadFields: ReceiptFieldName[];
};

// ---- Orchestration ----

export type AgentName = "reader" | "auditor" | "formFiller" | "dispatcher";

// The email the Dispatcher drafts for Accounts. Nothing is sent until the user approves.
export type EmailDraft = {
  // Display label only; the real address stays on the server.
  toLabel: string;
  subject: string;
  body: string;
  attachments: { label: string; filename: string }[];
  // HMAC over subject, body and the PDF, so only this exact draft can be sent.
  signature: string;
};

// The filled reimbursement form, produced by the Form Filler.
export type FilledForm = {
  filename: string;
  pdfBase64: string;
};

export type TraceStep = {
  agent: AgentName;
  title: string;
  detail: string;
};

export type ClaimResponse = {
  mode: "mock" | "live";
  fields: ReaderResult;
  audit: AuditResult;
  // Present only when the claim was approved.
  form?: FilledForm;
  draft?: EmailDraft;
  retries: number;
  trace: TraceStep[];
};

// Live events streamed from /api/claim (one JSON object per line).
export type PipelineEvent =
  | { type: "agent_start"; agent: AgentName; attempt: number; note: string }
  | {
      type: "agent_done";
      agent: "reader";
      attempt: number;
      summary: string;
      fields: ReaderResult;
    }
  | {
      type: "agent_done";
      agent: "auditor";
      attempt: number;
      summary: string;
      audit: AuditResult;
    }
  | {
      type: "agent_done";
      agent: "formFiller";
      attempt: number;
      summary: string;
      form: FilledForm;
    }
  | {
      type: "agent_done";
      agent: "dispatcher";
      attempt: number;
      summary: string;
      draft: EmailDraft;
    }
  | { type: "loop_back"; attempt: number; fields: ReceiptFieldName[]; reason: string }
  | { type: "complete"; result: ClaimResponse }
  | {
      type: "error";
      message: string;
      // What the user can do about it
      hint: string;
      // Which agent was working when it failed
      agent?: AgentName;
    };

export type ReaderResponse = {
  agent: "reader";
  mode: "mock" | "live";
  fields: ReaderResult;
};
