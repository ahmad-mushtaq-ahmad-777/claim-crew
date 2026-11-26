import type { ClaimConfig } from "@/lib/claim-configs";
import type { FilledForm, ReaderResult } from "@/lib/claim-types";
import { chatCompletion, isMockMode } from "@/lib/llm";
import { FORM_TOOLS, type FormToolContext, type OutputFormat } from "@/lib/tools/form-tools";

const MAX_ATTEMPTS = 2; // the first try plus one retry

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
    const tool = FORM_TOOLS.find((t) => t.outputFormat === outputFormat)!;
    const args = { claimType: config.id };
    return { ...(await tool.execute(ctx, args)), toolCall: { name: tool.name, arguments: args } };
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callToolViaModel(ctx, outputFormat);
    } catch (e) {
      lastError = e;
      console.warn(`Form Filler attempt ${attempt} failed:`, e instanceof Error ? e.message : e);
    }
  }
  throw new Error(
    `The Form Filler could not produce the form: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

async function callToolViaModel(
  ctx: FormToolContext,
  outputFormat: OutputFormat,
): Promise<FilledForm> {
  const { config } = ctx;
  const completion = await chatCompletion(
    {
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are the Form Filler agent in an expense-claim system. The claim has already been verified and approved. " +
            "Your job is to produce the company form in the requested output format by calling exactly one of the available tools. " +
            "Do not answer with text. Call the tool that matches the requested output format.",
        },
        {
          role: "user",
          content: JSON.stringify({
            requestedOutputFormat: outputFormat,
            claimType: config.id,
            form: config.formName,
          }),
        },
      ],
      tools: FORM_TOOLS.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
    },
    { timeout: 30_000 },
  );

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") {
    throw new Error("The model did not call a tool");
  }
  const tool = FORM_TOOLS.find((t) => t.name === call.function.name);
  if (!tool) throw new Error(`The model called an unknown tool "${call.function.name}"`);
  if (tool.outputFormat !== outputFormat) {
    throw new Error(`The model called ${tool.name}, which makes ${tool.outputFormat}, not ${outputFormat}`);
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    throw new Error(`The model sent invalid arguments to ${tool.name}`);
  }
  return { ...(await tool.execute(ctx, args)), toolCall: { name: tool.name, arguments: args } };
}
