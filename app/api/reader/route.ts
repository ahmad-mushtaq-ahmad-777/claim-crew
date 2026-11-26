import type { ReaderResponse } from "@/lib/claim-types";
import { runReader } from "@/lib/agents/reader";
import { CLAIM_CONFIGS } from "@/lib/claim-configs";
import { isMockMode } from "@/lib/llm";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
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
    fields: CLAIM_CONFIGS.internet.mockFields,
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
    return Response.json({ error: "Receipt must be 4 MB or smaller" }, { status: 413 });
  }

  if (isMockMode()) {
    return Response.json(mockReader());
  }

  try {
    const fields = await runReader(receipt, CLAIM_CONFIGS.internet);
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
