// The kinds of claim the system handles. Each has a config in claim-configs.ts.
export type ClaimTypeId = "internet" | "gym";

// The Classifier's decision about what kind of receipt was uploaded.
export type Classification = {
  type: ClaimTypeId | "unknown";
  // 0 to 1: how sure the Classifier is
  confidence: number;
  // One short sentence on what it saw
  reason: string;
};

// Field names depend on the claim type (see claim-configs.ts).
// "Number", signatures and approvals are intentionally NOT extracted.
export type ReceiptFieldName = string;

export type ExtractedField = {
  // null when the field could not be found on the receipt
  value: string | number | null;
  // 0 to 1: how sure the Reader is about this value
  confidence: number;
};

export type ReaderResult = Record<string, ExtractedField>;

// ---- Auditor ----

export type AuditCheck = {
  id: "year" | "expenseType" | "amount" | "confidence" | "cap";
  label: string;
  passed: boolean;
  // A heads-up that does not block the claim (shown in amber instead of a tick).
  note?: boolean;
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

export type AgentName =
  | "classifier"
  | "reader"
  | "auditor"
  | "formFiller"
  | "dispatcher";

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
  classification: Classification;
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
      agent: "classifier";
      attempt: number;
      summary: string;
      classification: Classification;
    }
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
