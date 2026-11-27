import type { ClaimTypeId, ReaderResult } from "@/lib/claim-types";
import { generateFormPdf } from "@/lib/form-pdf";
import { generateHealthClubPdf } from "@/lib/form-pdf-gym";

// Server-only: the PDF template for each claim type. Kept out of claim-configs.ts
// because that file is pure data and is also bundled into the browser.
// A new claim type adds one entry here (and one in CLAIM_CONFIGS).
export type FormGenerator = (fields: ReaderResult, designation: string) => Promise<Uint8Array>;

export const FORM_GENERATORS: Record<ClaimTypeId, FormGenerator> = {
  internet: (fields) => generateFormPdf(fields),
  gym: (fields, designation) => generateHealthClubPdf(fields, designation),
};
