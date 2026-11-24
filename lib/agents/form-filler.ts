import type { ClaimConfig } from "@/lib/claim-configs";
import type { FilledForm, ReaderResult } from "@/lib/claim-types";
import { generateFormPdf } from "@/lib/form-pdf";
import { generateHealthClubPdf } from "@/lib/form-pdf-gym";

function safe(part: string): string {
  return part.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Form Filler: maps the verified receipt fields onto the right company form and renders a PDF.
export async function runFormFiller(
  fields: ReaderResult,
  config: ClaimConfig,
  designation = "",
): Promise<FilledForm> {
  const bytes =
    config.id === "gym"
      ? await generateHealthClubPdf(fields, designation)
      : await generateFormPdf(fields);
  const who = safe(String(fields.beneficiary?.value ?? "employee"));
  const month = safe(String(fields.month?.value ?? "month"));
  return {
    filename: `${safe(config.formName)}-${who}-${month}.pdf`,
    pdfBase64: Buffer.from(bytes).toString("base64"),
  };
}
