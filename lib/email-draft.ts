import {
  reimbursableAmount,
  type ClaimConfig,
} from "@/lib/claim-configs";
import type { EmailDraft, FilledForm, ReaderResult } from "@/lib/claim-types";
import { signDraft } from "@/lib/draft-signing";

const val = (fields: ReaderResult, key: string) => {
  const v = fields[key]?.value;
  return v === null || v === undefined ? "" : String(v);
};

function money(n: number | string): string {
  return typeof n === "number"
    ? `Rs. ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : n;
}

function amountOf(fields: ReaderResult): number | string {
  const v = fields.amount?.value;
  return typeof v === "number" ? v : val(fields, "amount");
}

export function buildSubject(fields: ReaderResult, config: ClaimConfig): string {
  const year = val(fields, "date").match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  return `${config.email.subjectTitle} - ${val(fields, "beneficiary")} - ${val(fields, "month")} ${year}`.trim();
}

// Fixed template per claim type: every email has a consistent layout, and only the
// verified receipt values are substituted in. No free-form model text.
export function buildBody(
  fields: ReaderResult,
  config: ClaimConfig,
  designation = "",
): string {
  const amount = amountOf(fields);
  const line = (label: string, value: string) => `  ${`${label}:`.padEnd(19)}${value}`;
  const details = config.email.details.flatMap((d): string[] => {
    if ("special" in d) {
      if (d.special === "designation") {
        return designation ? [line(d.label, designation)] : [];
      }
      const pct = Math.round(config.reimbursementRate * 100);
      const value = typeof amount === "number" ? money(reimbursableAmount(amount, config)) : "";
      return [line(d.label, `${value} (${pct}% ${d.note})`)];
    }
    return [line(d.label, d.money ? money(amount) : val(fields, d.field))];
  });

  return [
    "Dear Accounts Team,",
    "",
    `Please find attached my ${config.email.claimName} for the month of ${val(fields, "month")}.`,
    "",
    "Claim details",
    ...details,
    "",
    "Attachments",
    "  1. Original receipt",
    `  2. Completed ${config.formName}`,
    "",
    "Kindly review and process the reimbursement.",
    "",
    "Regards,",
    val(fields, "beneficiary"),
    "",
    "-- Prepared by ClaimCrew (demo with made-up data)",
  ].join("\n");
}

export type EmailDraftInput = {
  fields: ReaderResult;
  form: FilledForm;
  receiptFilename: string;
  config: ClaimConfig;
  designation: string;
};

// Builds the fixed-template email and signs it. Subject, body and signature are made
// here in code, so the model can never change what Accounts will receive.
export function buildEmailDraft({
  fields,
  form,
  receiptFilename,
  config,
  designation,
}: EmailDraftInput): EmailDraft {
  const subject = buildSubject(fields, config);
  const body = buildBody(fields, config, designation);
  return {
    toLabel: "Accounts Department (demo mailbox)",
    subject,
    body,
    attachments: [
      { label: "Original receipt", filename: receiptFilename },
      { label: "Filled expense sheet", filename: form.filename },
    ],
    signature: signDraft(subject, body, form.pdfBase64),
  };
}
