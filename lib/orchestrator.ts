import { runClassifier } from "@/lib/agents/classifier";
import { runReader } from "@/lib/agents/reader";
import { CLAIM_CONFIGS, type ClaimConfig } from "@/lib/claim-configs";
import { runAuditor } from "@/lib/agents/auditor";
import { runDispatcher } from "@/lib/agents/dispatcher";
import { runFormFiller } from "@/lib/agents/form-filler";
import type {
  AuditResult,
  Classification,
  ClaimResponse,
  ClaimTypeId,
  EmailDraft,
  FilledForm,
  PipelineEvent,
  ReaderResult,
  ReceiptFieldName,
  TraceStep,
} from "@/lib/claim-types";
import { isMockMode } from "@/lib/llm";
import { POLICY } from "@/lib/policy";

type Emit = (event: PipelineEvent) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readReceipt(
  file: File,
  config: ClaimConfig,
  focus: ReceiptFieldName[] = [],
): Promise<ReaderResult> {
  if (isMockMode()) {
    await sleep(1200); // simulate work so the live UI is visible in mock mode
    return config.mockFields;
  }
  return runReader(file, config, focus);
}

// Keep the better of old/new reading for each re-read field.
function mergeRereads(
  previous: ReaderResult,
  next: ReaderResult,
  focus: ReceiptFieldName[],
): ReaderResult {
  const merged = { ...previous };
  for (const f of focus) {
    const better =
      next[f].value !== null && next[f].confidence >= previous[f].confidence;
    if (better) merged[f] = next[f];
  }
  return merged;
}

// Reader -> Auditor, looping back to the Reader while the Auditor asks for a re-read.
export async function runClaimPipeline(
  file: File,
  designation: string,
  emit: Emit = () => {},
): Promise<ClaimResponse> {
  const trace: TraceStep[] = [];
  let fields: ReaderResult;
  let audit: AuditResult;
  let retries = 0;

  // --- Classifier: decides what kind of claim this is; every later agent follows it ---
  emit({
    type: "agent_start",
    agent: "classifier",
    attempt: 1,
    note: "Looking at the receipt to decide what kind of claim it is",
  });
  let classification: Classification;
  if (isMockMode()) {
    await sleep(800);
    classification = {
      type: "internet",
      confidence: 0.95,
      reason: "Mock mode: treating the receipt as an internet bill.",
    };
  } else {
    classification = await runClassifier(file);
  }
  const recognised =
    classification.type !== "unknown" &&
    classification.confidence >= POLICY.minClassifyConfidence;
  const classifierSummary = recognised
    ? `Detected a ${CLAIM_CONFIGS[classification.type as ClaimTypeId].label}`
    : "Could not tell what kind of receipt this is";
  trace.push({
    agent: "classifier",
    title: `Classifier: ${classification.type}`,
    detail: classification.reason,
  });
  emit({
    type: "agent_done",
    agent: "classifier",
    attempt: 1,
    summary: classifierSummary,
    classification,
  });

  // Not a receipt type we handle: stop here with a clear reason.
  if (!recognised) {
    const reason =
      "This doesn't look like an internet bill or a health club receipt, so no claim was started. Please upload one of those receipts.";
    const result: ClaimResponse = {
      mode: isMockMode() ? "mock" : "live",
      classification,
      fields: {},
      audit: {
        agent: "auditor",
        verdict: "rejected",
        checks: [],
        reason,
        rereadFields: [],
      },
      retries: 0,
      trace,
    };
    emit({ type: "complete", result });
    return result;
  }
  const config = CLAIM_CONFIGS[classification.type as ClaimTypeId];

  // --- Reader, first pass ---
  emit({
    type: "agent_start",
    agent: "reader",
    attempt: 1,
    note: "Reading the receipt and extracting the form fields",
  });
  fields = await readReceipt(file, config);
  trace.push({
    agent: "reader",
    title: "Reader extracted the receipt",
    detail: `Read ${Object.keys(fields).length} fields.`,
  });
  emit({
    type: "agent_done",
    agent: "reader",
    attempt: 1,
    summary: `Extracted ${Object.keys(fields).length} fields from the receipt`,
    fields,
  });

  // --- Auditor, first pass ---
  emit({
    type: "agent_start",
    agent: "auditor",
    attempt: 1,
    note: "Checking the claim against company policy",
  });
  audit = await runAuditor(fields, config);
  trace.push({
    agent: "auditor",
    title: `Auditor verdict: ${audit.verdict}`,
    detail: audit.reason,
  });
  emit({
    type: "agent_done",
    agent: "auditor",
    attempt: 1,
    summary: audit.reason,
    audit,
  });

  // --- Loop back while the Auditor is unsure ---
  while (audit.verdict === "needs_reread" && retries < POLICY.maxRetries) {
    retries += 1;
    const focus = audit.rereadFields;
    trace.push({
      agent: "auditor",
      title: `Auditor asked the Reader to re-read (attempt ${retries})`,
      detail: `Fields: ${focus.join(", ")}.`,
    });
    emit({
      type: "loop_back",
      attempt: retries,
      fields: focus,
      reason: audit.reason,
    });

    emit({
      type: "agent_start",
      agent: "reader",
      attempt: retries + 1,
      note: `Re-reading: ${focus.join(", ")}`,
    });
    const reread = await readReceipt(file, config, focus);
    fields = mergeRereads(fields, reread, focus);
    trace.push({
      agent: "reader",
      title: `Reader re-read ${focus.join(", ")}`,
      detail: "Updated the unclear fields.",
    });
    emit({
      type: "agent_done",
      agent: "reader",
      attempt: retries + 1,
      summary: `Re-read ${focus.join(", ")}`,
      fields,
    });

    emit({
      type: "agent_start",
      agent: "auditor",
      attempt: retries + 1,
      note: "Re-checking the claim",
    });
    audit = await runAuditor(fields, config);
    trace.push({
      agent: "auditor",
      title: `Auditor verdict: ${audit.verdict}`,
      detail: audit.reason,
    });
    emit({
      type: "agent_done",
      agent: "auditor",
      attempt: retries + 1,
      summary: audit.reason,
      audit,
    });
  }

  // Still unclear after all retries: reject with a clear reason.
  if (audit.verdict === "needs_reread") {
    audit = { ...audit, verdict: "rejected" };
  }

  // --- Form Filler: only for approved claims ---
  let form: FilledForm | undefined;
  if (audit.verdict === "approved") {
    emit({
      type: "agent_start",
      agent: "formFiller",
      attempt: 1,
      note: `Filling in the ${config.formName}`,
    });
    if (isMockMode()) await sleep(900); // keep the live UI visible in mock mode
    form = await runFormFiller(fields, config, designation);
    trace.push({
      agent: "formFiller",
      title: "Form Filler completed the expense sheet",
      detail: form.filename,
    });
    emit({
      type: "agent_done",
      agent: "formFiller",
      attempt: 1,
      summary: `Filled the expense sheet (${form.filename})`,
      form,
    });
  }

  // --- Dispatcher: drafts the email to Accounts (nothing is sent here) ---
  let draft: EmailDraft | undefined;
  if (form) {
    emit({
      type: "agent_start",
      agent: "dispatcher",
      attempt: 1,
      note: "Drafting the email to Accounts with both attachments",
    });
    if (isMockMode()) await sleep(900);
    draft = await runDispatcher(fields, form, file.name || "receipt", config, designation);
    trace.push({
      agent: "dispatcher",
      title: "Dispatcher drafted the email to Accounts",
      detail: draft.subject,
    });
    emit({
      type: "agent_done",
      agent: "dispatcher",
      attempt: 1,
      summary: "Drafted the email with the receipt and the filled form attached",
      draft,
    });
  }

  const result: ClaimResponse = {
    mode: isMockMode() ? "mock" : "live",
    classification,
    fields,
    audit,
    form,
    draft,
    retries,
    trace,
  };
  emit({ type: "complete", result });
  return result;
}
