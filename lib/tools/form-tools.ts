import { CLAIM_CONFIGS, type ClaimConfig } from "@/lib/claim-configs";
import type { FilledForm, ReaderResult } from "@/lib/claim-types";
import { FORM_GENERATORS } from "@/lib/form-generators";
import type { AgentTool } from "@/lib/tools/tool-agent";

// Tools the Form Filler agent can call. To support a new output format (Word, Excel...),
// add one entry to FORM_TOOLS and a matching OutputFormat. The agent picks it up from there.
export type OutputFormat = "pdf";

// Server-side data the tools work on. It never passes through the model, so verified
// values (names, dates, amounts) cannot be altered by it.
export type FormToolContext = {
  fields: ReaderResult;
  config: ClaimConfig;
  designation: string;
};

export type FormTool = AgentTool<FormToolContext, FilledForm> & { kind: OutputFormat };

function safe(part: string): string {
  return part.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const generateFormPdfTool: FormTool = {
  name: "generate_form_pdf",
  kind: "pdf",
  description:
    "Fills in the company reimbursement form for the approved claim and renders it as a PDF. " +
    "Use it whenever the requested output format is pdf. " +
    "The verified claim data is attached on the server and the reimbursable amount is calculated by the tool, so only the claim type is needed.",
  parameters: {
    type: "object",
    properties: {
      claimType: {
        type: "string",
        enum: Object.keys(CLAIM_CONFIGS),
        description: "The type of the claim the form is for.",
      },
    },
    required: ["claimType"],
    additionalProperties: false,
  },
  async execute({ fields, config, designation }, args) {
    const claimType = (args as { claimType?: unknown } | null)?.claimType;
    if (claimType !== config.id) {
      throw new Error(
        `generate_form_pdf was called with claimType "${String(claimType)}" but this claim is "${config.id}"`,
      );
    }
    const bytes = await FORM_GENERATORS[config.id](fields, designation);
    const who = safe(String(fields.beneficiary?.value ?? "employee"));
    const month = safe(String(fields.month?.value ?? "month"));
    return {
      filename: `${safe(config.formName)}-${who}-${month}.pdf`,
      pdfBase64: Buffer.from(bytes).toString("base64"),
    };
  },
};

export const FORM_TOOLS: FormTool[] = [generateFormPdfTool];
