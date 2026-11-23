import OpenAI from "openai";

// Provider-neutral: works with Gemini's OpenAI-compatible endpoint or LiteLLM.
// Swap providers by changing LLM_BASE_URL, LLM_API_KEY and LLM_MODEL only.
export function isMockMode(): boolean {
  return process.env.MOCK_LLM !== "false";
}

export function getLLM() {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseURL || !apiKey || !model) {
    throw new Error(
      "LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set when MOCK_LLM=false",
    );
  }
  return { client: new OpenAI({ baseURL, apiKey }), model };
}
