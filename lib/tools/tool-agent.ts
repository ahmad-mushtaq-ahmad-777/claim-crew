import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { chatCompletion } from "@/lib/llm";

// A final tool an agent can call. `kind` says what the tool produces (for example "pdf" or
// "email"), so the model can match the requested kind to the right tool. Calling one of
// these ends the run and its result is what the agent returns.
export type AgentTool<Ctx, Out> = {
  name: string;
  kind: string;
  description: string;
  // JSON schema shown to the model
  parameters: Record<string, unknown>;
  execute: (ctx: Ctx, args: unknown) => Promise<Out>;
};

// A tool whose result goes back to the model, which then decides its next step (for example
// "run the policy checks, then decide"). It does not end the run.
export type InfoTool<Ctx> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (ctx: Ctx, args: unknown) => Promise<unknown>;
};

export type ToolCallRecord = { name: string; arguments: Record<string, unknown> };

const MAX_ATTEMPTS = 2; // the first try plus one retry
const MAX_TURNS = 4; // model calls in one attempt, so an info tool cannot loop forever

type RunOptions<Ctx, Out> = {
  system: string;
  // What the agent is asked to do. Sent to the model as JSON.
  request: Record<string, unknown> & { kind: string };
  tools: AgentTool<Ctx, Out>[];
  // Optional tools that feed information back to the model before it chooses a final tool.
  infoTools?: InfoTool<Ctx>[];
  // If set, the model must call this info tool before any final tool.
  requireFirst?: string;
  ctx: Ctx;
  // Start of the error message if every attempt fails, e.g. "The Form Filler could not produce the form"
  failurePrefix: string;
};

export type ToolAgentResult<Out> = {
  result: Out;
  // The final tool the model chose.
  toolCall: ToolCallRecord;
  // Every tool the model called, in order (info tools first, final tool last).
  toolCalls: ToolCallRecord[];
};

// Shared loop for tool-calling agents: the model is given a goal and a set of tools, it must
// call one, we validate the call and run the tool. A bad or missing call is retried once,
// then the run stops with a clear error (there is no silent fallback).
export async function runToolAgent<Ctx, Out>(
  opts: RunOptions<Ctx, Out>,
): Promise<ToolAgentResult<Out>> {
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

function parseArgs(raw: string | undefined, toolName: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error(`The model sent invalid arguments to ${toolName}`);
  }
}

async function attemptOnce<Ctx, Out>(opts: RunOptions<Ctx, Out>): Promise<ToolAgentResult<Out>> {
  const { system, request, tools, ctx, requireFirst } = opts;
  const infoTools = opts.infoTools ?? [];
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(request) },
  ];
  const toolDefs = [...infoTools, ...tools].map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const toolCalls: ToolCallRecord[] = [];
  const usedInfo = new Set<string>();

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const completion = await chatCompletion(
      { temperature: 0, messages, tools: toolDefs, tool_choice: "auto" },
      { timeout: 30_000 },
    );

    const message = completion.choices[0]?.message;
    const call = message?.tool_calls?.[0];
    if (!message || !call || call.type !== "function") {
      throw new Error("The model did not call a tool");
    }
    const args = parseArgs(call.function.arguments, call.function.name);

    // Info tool: run it, give the result back to the model, and let it decide the next step.
    const info = infoTools.find((t) => t.name === call.function.name);
    if (info) {
      const output = await info.run(ctx, args);
      toolCalls.push({ name: info.name, arguments: args });
      usedInfo.add(info.name);
      // Only the first call is answered, so only that one goes back in the history.
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: [call] });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      continue;
    }

    // Final tool: validate and run it.
    const tool = tools.find((t) => t.name === call.function.name);
    if (!tool) throw new Error(`The model called an unknown tool "${call.function.name}"`);
    if (tool.kind !== request.kind) {
      throw new Error(`The model called ${tool.name}, which makes ${tool.kind}, not ${request.kind}`);
    }
    if (requireFirst && !usedInfo.has(requireFirst)) {
      throw new Error(`The model must call ${requireFirst} before ${tool.name}`);
    }
    const result = await tool.execute(ctx, args);
    const record = { name: tool.name, arguments: args };
    toolCalls.push(record);
    return { result, toolCall: record, toolCalls };
  }
  throw new Error("The model did not reach a final tool call");
}
