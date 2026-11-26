import type { EmailDraft } from "@/lib/claim-types";
import { buildEmailDraft, type EmailDraftInput } from "@/lib/email-draft";
import type { AgentTool } from "@/lib/tools/tool-agent";

// Tools the Dispatcher agent can call. To support a new channel (Slack, Teams...), add one
// entry to DISPATCH_TOOLS and a matching Channel. The agent picks it up from there.
export type Channel = "email";

export type DispatchToolContext = EmailDraftInput;

export type DispatchTool = AgentTool<DispatchToolContext, EmailDraft> & { kind: Channel };

const draftClaimEmailTool: DispatchTool = {
  name: "draft_claim_email",
  kind: "email",
  description:
    "Drafts the email to the Accounts department for the approved claim, with the receipt and the filled form attached, and signs the draft. " +
    "Use it whenever the requested channel is email. " +
    "It only drafts: nothing is sent until the employee approves. The claim data is attached on the server, so only the claim type is needed.",
  parameters: {
    type: "object",
    properties: {
      claimType: {
        type: "string",
        enum: ["internet", "gym"],
        description: "The type of the claim the email is for.",
      },
    },
    required: ["claimType"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const claimType = (args as { claimType?: unknown } | null)?.claimType;
    if (claimType !== ctx.config.id) {
      throw new Error(
        `draft_claim_email was called with claimType "${String(claimType)}" but this claim is "${ctx.config.id}"`,
      );
    }
    return buildEmailDraft(ctx);
  },
};

export const DISPATCH_TOOLS: DispatchTool[] = [draftClaimEmailTool];
