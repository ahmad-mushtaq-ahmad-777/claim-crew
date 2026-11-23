import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

// Provider-neutral: works with Gemini's OpenAI-compatible endpoint or LiteLLM.
// Swap providers by changing LLM_BASE_URL, LLM_API_KEY and LLM_MODEL only.
export function isMockMode(): boolean {
  return process.env.MOCK_LLM !== "false";
}

function getConfig() {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      "LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set when MOCK_LLM=false",
    );
  }
  // Optional: comma-separated backup models tried when the main one is overloaded.
  const fallbacks = (process.env.LLM_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return { baseURL, apiKey, models: [model, ...fallbacks] };
}

// Errors worth retrying on another model (overload, rate limit, timeouts, network).
function isRetryable(e: unknown): boolean {
  if (e instanceof OpenAI.APIConnectionError) return true; // includes timeouts
  if (e instanceof OpenAI.APIError) {
    const s = e.status;
    return s === 429 || s === 408 || s === 404 || (s !== undefined && s >= 500);
  }
  return false;
}

// One chat call that automatically falls back to the next configured model.
export async function chatCompletion(
  params: Omit<ChatCompletionCreateParamsNonStreaming, "model">,
  opts: { timeout?: number; maxModels?: number } = {},
): Promise<ChatCompletion> {
  const config = getConfig();
  const { baseURL, apiKey } = config;
  const models = config.models.slice(0, opts.maxModels ?? config.models.length);
  // Each model gets one attempt; the fallback list provides the redundancy.
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0 });
  let lastError: unknown;
  for (const model of models) {
    try {
      return await client.chat.completions.create(
        { ...params, model },
        { timeout: opts.timeout ?? 30_000 },
      );
    } catch (e) {
      lastError = e;
      console.warn(`LLM call failed on "${model}":`, e instanceof Error ? e.message : e);
      if (!isRetryable(e)) throw e;
    }
  }
  throw lastError;
}
