import OpenAI from "openai";

// Turn raw model/provider errors into messages a user can act on.
export function describeError(e: unknown): { message: string; hint: string } {
  if (e instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      message: "The AI model took too long to respond.",
      hint: "This is usually temporary. Wait a few seconds and try again.",
    };
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return {
      message: "Could not reach the AI model.",
      hint: "Check your connection and try again in a moment.",
    };
  }
  if (e instanceof OpenAI.APIError) {
    const status = e.status;
    if (status === 429) {
      return {
        message: "The AI model is receiving too many requests right now.",
        hint: "Please wait about a minute and try again.",
      };
    }
    if (status === 401 || status === 403) {
      return {
        message: "The AI model rejected our credentials.",
        hint: "The API key is missing, wrong or expired. Tell the app owner.",
      };
    }
    if (status === 404) {
      return {
        message: "The configured AI model is not available.",
        hint: "The model name may be retired. Tell the app owner to update it.",
      };
    }
    if (status && status >= 500) {
      return {
        message: "The AI model is temporarily unavailable or overloaded.",
        hint: "This is on the provider's side. Try again shortly.",
      };
    }
  }
  if (e instanceof Error && e.message.includes("must be set")) {
    return {
      message: "The app is not connected to an AI model yet.",
      hint: "The LLM settings are missing. Tell the app owner.",
    };
  }
  if (e instanceof SyntaxError) {
    return {
      message: "The AI model returned an answer we could not understand.",
      hint: "Try again. If it keeps happening, try a clearer receipt image.",
    };
  }
  return {
    message: "Something unexpected went wrong while processing the receipt.",
    hint: "Please try again. If it keeps failing, try a different receipt file.",
  };
}
