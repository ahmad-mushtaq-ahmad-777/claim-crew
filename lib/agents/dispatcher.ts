import type { ClaimConfig } from "@/lib/claim-configs";
import type { EmailDraft, FilledForm, ReaderResult } from "@/lib/claim-types";
import { isMockMode } from "@/lib/llm";
import { DISPATCH_TOOLS, type Channel, type DispatchToolContext } from "@/lib/tools/dispatch-tools";
import { runToolAgent } from "@/lib/tools/tool-agent";

// Dispatcher: a tool-calling agent. It is told which channel to use (email today), the model
// picks the matching tool and calls it, and our code runs the tool. Nothing is sent here.
export async function runDispatcher(
  fields: ReaderResult,
  form: FilledForm,
  receiptFilename: string,
  config: ClaimConfig,
  designation = "",
  channel: Channel = "email",
): Promise<EmailDraft> {
  const ctx: DispatchToolContext = { fields, form, receiptFilename, config, designation };

  // Mock mode runs without any model, so call the matching tool directly.
  if (isMockMode()) {
    const tool = DISPATCH_TOOLS.find((t) => t.kind === channel)!;
    const args = { claimType: config.id };
    return { ...(await tool.execute(ctx, args)), toolCall: { name: tool.name, arguments: args } };
  }

  const { result, toolCall } = await runToolAgent({
    system:
      "You are the Dispatcher agent in an expense-claim system. The claim has been verified and the form is filled. " +
      "Your job is to prepare the message to Accounts on the requested channel by calling exactly one of the available tools. " +
      "Do not answer with text. Call the tool that matches the requested channel. You only draft: nothing is sent.",
    request: { kind: channel, requestedChannel: channel, claimType: config.id, form: config.formName },
    tools: DISPATCH_TOOLS,
    ctx,
    failurePrefix: "The Dispatcher could not prepare the message",
  });
  return { ...result, toolCall };
}
