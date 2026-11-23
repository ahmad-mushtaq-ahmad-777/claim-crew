import { mockReaderFields, runReader } from "@/lib/agents/reader";
import { runAuditor } from "@/lib/agents/auditor";
import type {
  AuditResult,
  ClaimResponse,
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
  focus: ReceiptFieldName[] = [],
): Promise<ReaderResult> {
  if (isMockMode()) {
    await sleep(1200); // simulate work so the live UI is visible in mock mode
    return mockReaderFields();
  }
  return runReader(file, focus);
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
  emit: Emit = () => {},
): Promise<ClaimResponse> {
  const trace: TraceStep[] = [];
  let fields: ReaderResult;
  let audit: AuditResult;
  let retries = 0;

  // --- Reader, first pass ---
  emit({
    type: "agent_start",
    agent: "reader",
    attempt: 1,
    note: "Reading the receipt and extracting the form fields",
  });
  fields = await readReceipt(file);
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
  audit = await runAuditor(fields);
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
    const reread = await readReceipt(file, focus);
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
    audit = await runAuditor(fields);
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

  const result: ClaimResponse = {
    mode: isMockMode() ? "mock" : "live",
    fields,
    audit,
    retries,
    trace,
  };
  emit({ type: "complete", result });
  return result;
}
