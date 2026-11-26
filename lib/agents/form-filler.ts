import type { ClaimConfig } from "@/lib/claim-configs";
import type { FilledForm, ReaderResult } from "@/lib/claim-types";
import { isMockMode } from "@/lib/llm";
import { FORM_TOOLS, type FormToolContext, type OutputFormat } from "@/lib/tools/form-tools";
import { runToolAgent } from "@/lib/tools/tool-agent";

// Form Filler: a tool-calling agent. It is told which output format is wanted, the model
// picks the matching tool and calls it, and our code runs that tool and returns the result.
export async function runFormFiller(
  fields: ReaderResult,
  config: ClaimConfig,
  designation = "",
  outputFormat: OutputFormat = "pdf",
): Promise<FilledForm> {
  const ctx: FormToolContext = { fields, config, designation };

  // Mock mode runs without any model, so call the matching tool directly.
  if (isMockMode()) {
    const tool = FORM_TOOLS.find((t) => t.kind === outputFormat)!;
    const args = { claimType: config.id };
    return { ...(await tool.execute(ctx, args)), toolCall: { name: tool.name, arguments: args } };
  }

  const { result, toolCall } = await runToolAgent({
    system:
      "You are the Form Filler agent in an expense-claim system. The claim has already been verified and approved. " +
      "Your job is to produce the company form in the requested output format by calling exactly one of the available tools. " +
      "Do not answer with text. Call the tool that matches the requested output format.",
    request: { kind: outputFormat, requestedOutputFormat: outputFormat, claimType: config.id, form: config.formName },
    tools: FORM_TOOLS,
    ctx,
    failurePrefix: "The Form Filler could not produce the form",
  });
  return { ...result, toolCall };
}
