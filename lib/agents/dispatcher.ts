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
  const title = config.id === "gym" ? "Health Club Expense Claim" : "Internet Expense Claim";
  return `${title} - ${val(fields, "beneficiary")} - ${val(fields, "month")} ${year}`.trim();
}

// Fixed template per claim type: every email has a consistent layout, and only the
// verified receipt values are substituted in. No free-form model text.
export function buildBody(
  fields: ReaderResult,
  config: ClaimConfig,
  designation = "",
): string {
  const gym = config.id === "gym";
  const amount = amountOf(fields);
  const details = gym
    ? [
        `  Employee:          ${val(fields, "beneficiary")}`,
        ...(designation ? [`  Designation:       ${designation}`] : []),
        `  Health club:       ${val(fields, "healthClub")}`,
        `  Receipt date:      ${val(fields, "date")}`,
        `  Membership month:  ${val(fields, "month")}`,
        `  Monthly dues:      ${money(amount)}`,
        `  Reimbursable:      ${typeof amount === "number" ? money(reimbursableAmount(amount, config)) : ""} (60% of the dues)`,
      ]
    : [
        `  Employee:          ${val(fields, "beneficiary")}`,
        `  Service provider:  ${val(fields, "serviceProvider")}`,
        `  Receipt date:      ${val(fields, "date")}`,
        `  Nature of expense: ${val(fields, "natureOfExpense")}`,
        `  Amount:            ${money(amount)}`,
      ];

  return [
    "Dear Accounts Team,",
    "",
    gym
      ? `Please find attached my health club membership expense claim for the month of ${val(fields, "month")}.`
      : `Please find attached my internet expense claim for the month of ${val(fields, "month")}.`,
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

export async function runDispatcher(
  fields: ReaderResult,
  form: FilledForm,
  receiptFilename: string,
  config: ClaimConfig,
  designation = "",
): Promise<EmailDraft> {
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
