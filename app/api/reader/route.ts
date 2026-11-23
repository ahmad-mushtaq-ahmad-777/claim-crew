import type { ReaderResponse } from "@/lib/claim-types";
import { runReader } from "@/lib/agents/reader";
import { isMockMode } from "@/lib/llm";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

function mockReader(): ReaderResponse {
  return {
    agent: "reader",
    mode: "mock",
    fields: {
      beneficiary: { value: "Jane Doe", confidence: 0.95 },
      serviceProvider: { value: "Example ISP", confidence: 0.97 },
      date: { value: "2026-11-05", confidence: 0.93 },
      month: { value: "November", confidence: 0.9 },
      natureOfExpense: { value: "Internet bill", confidence: 0.96 },
      amount: { value: 4500, confidence: 0.98 },
    },
  };
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const receipt = form.get("receipt");
  if (!(receipt instanceof File)) {
    return Response.json({ error: "Missing 'receipt' file" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(receipt.type)) {
    return Response.json(
      { error: "Receipt must be a JPG, PNG, WebP, HEIC or PDF file" },
      { status: 415 },
    );
  }
  if (receipt.size > MAX_BYTES) {
    return Response.json({ error: "Receipt must be 5 MB or smaller" }, { status: 413 });
  }

  if (isMockMode()) {
    return Response.json(mockReader());
  }

  try {
    const fields = await runReader(receipt);
    const response: ReaderResponse = { agent: "reader", mode: "live", fields };
    return Response.json(response);
  } catch (e) {
    console.error("Reader failed:", e);
    return Response.json(
      { error: "Reader could not process this receipt. Please try again." },
      { status: 502 },
    );
  }
}
