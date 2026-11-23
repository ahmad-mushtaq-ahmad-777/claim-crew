import type { FilledForm, ReaderResult } from "@/lib/claim-types";
import { generateFormPdf } from "@/lib/form-pdf";

function safe(part: string): string {
  return part.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Form Filler: maps the verified receipt fields onto the company form and renders a PDF.
export async function runFormFiller(fields: ReaderResult): Promise<FilledForm> {
  const bytes = await generateFormPdf(fields);
  const who = safe(String(fields.beneficiary.value ?? "employee"));
  const month = safe(String(fields.month.value ?? "month"));
  return {
    filename: `Internet-Expense-Sheet-${who}-${month}.pdf`,
    pdfBase64: Buffer.from(bytes).toString("base64"),
  };
}
