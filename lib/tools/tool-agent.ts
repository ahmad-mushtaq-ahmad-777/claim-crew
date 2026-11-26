import { chatCompletion } from "@/lib/llm";

// A tool an agent can call. `kind` says what the tool produces (for example "pdf" or "email"),
// so the model can match the requested kind to the right tool.
export type AgentTool<Ctx, Out> = {
  name: string;
  kind: string;
  description: string;
  // JSON schema shown to the model
  parameters: Record<string, unknown>;
  execute: (ctx: Ctx, args: unknown) => Promise<Out>;
};

export type ToolCallRecord = { name: string; arguments: Record<string, unknown> };

const MAX_ATTEMPTS = 2; // the first try plus one retry

// Shared loop for tool-calling agents: the model is given a goal and a set of tools, it must
// call one, we validate the call and run the tool. A bad or missing call is retried once,
// then the run stops with a clear error (there is no silent fallback).
export async function runToolAgent<Ctx, Out>(opts: {
  system: string;
  // What the agent is asked to do. Sent to the model as JSON.
  request: Record<string, unknown> & { kind: string };
  tools: AgentTool<Ctx, Out>[];
  ctx: Ctx;
  // Start of the error message if every attempt fails, e.g. "The Form Filler could not produce the form"
  failurePrefix: string;
}): Promise<{ result: Out; toolCall: ToolCallRecord }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptOnce(opts);
    } catch (e) {
      lastError = e;
      console.warn(`${opts.failurePrefix} (attempt ${attempt}):`, e instanceof Error ? e.message : e);
    }
  }
  throw new Error(
    `${opts.failurePrefix}: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

async function attemptOnce<Ctx, Out>(opts: {
  system: string;
  request: Record<string, unknown> & { kind: string };
  tools: AgentTool<Ctx, Out>[];
  ctx: Ctx;
}): Promise<{ result: Out; toolCall: ToolCallRecord }> {
  const { system, request, tools, ctx } = opts;
  const completion = await chatCompletion(
    {
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(request) },
      ],
      tools: tools.map((t) => ({
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
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) throw new Error(`The model called an unknown tool "${call.function.name}"`);
  if (tool.kind !== request.kind) {
    throw new Error(`The model called ${tool.name}, which makes ${tool.kind}, not ${request.kind}`);
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    throw new Error(`The model sent invalid arguments to ${tool.name}`);
  }
  return { result: await tool.execute(ctx, args), toolCall: { name: tool.name, arguments: args } };
}
