import type { EmailDraft, FilledForm, ReaderResult } from "@/lib/claim-types";
import { signDraft } from "@/lib/draft-signing";

const val = (f: { value: string | number | null }) =>
  f.value === null ? "" : String(f.value);

function money(f: ReaderResult["amount"]): string {
  return typeof f.value === "number"
    ? f.value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : val(f);
}

export function buildSubject(fields: ReaderResult): string {
  const year = val(fields.date).match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  return `Internet Expense Claim - ${val(fields.beneficiary)} - ${val(fields.month)} ${year}`.trim();
}

// Fixed template: every claim email has the same consistent layout, and only
// the verified receipt values are substituted in. No free-form model text.
export function buildBody(fields: ReaderResult): string {
  return [
    "Dear Accounts Team,",
    "",
    `Please find attached my internet expense claim for the month of ${val(fields.month)}.`,
    "",
    "Claim details",
    `  Employee:          ${val(fields.beneficiary)}`,
    `  Service provider:  ${val(fields.serviceProvider)}`,
    `  Receipt date:      ${val(fields.date)}`,
    `  Nature of expense: ${val(fields.natureOfExpense)}`,
    `  Amount:            ${money(fields.amount)}`,
    "",
    "Attachments",
    "  1. Original receipt",
    "  2. Completed Internet Expense Sheet",
    "",
    "Kindly review and process the reimbursement.",
    "",
    "Regards,",
    val(fields.beneficiary),
    "",
    "-- Prepared by ClaimCrew (demo with made-up data)",
  ].join("\n");
}

export async function runDispatcher(
  fields: ReaderResult,
  form: FilledForm,
  receiptFilename: string,
): Promise<EmailDraft> {
  const subject = buildSubject(fields);
  const body = buildBody(fields);
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
