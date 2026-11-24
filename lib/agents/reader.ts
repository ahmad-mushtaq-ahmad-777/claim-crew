import type { ClaimConfig } from "@/lib/claim-configs";
import type {
  ExtractedField,
  ReaderResult,
  ReceiptFieldName,
} from "@/lib/claim-types";
import sharp from "sharp";
import { chatCompletion } from "@/lib/llm";

function buildSystemPrompt(config: ClaimConfig): string {
  const fieldLines = config.fields
    .map((f) => `- ${f}: ${config.fieldHints[f]}`)
    .join("\n");
  const shape = config.fields.map((f) => `"${f}":{"value":...,"confidence":...}`).join(",");
  return `You are the Reader agent in an expense-claim system.
You receive one ${config.documentName} (image or PDF) and extract ONLY these fields:
${fieldLines}

Rules:
- Never invent values. If a field is not visible, use null with confidence 0.
- confidence is a number from 0 to 1 for how sure you are about that value.
- Respond with JSON only, in exactly this shape:
{${shape}}`;
}

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function parseField(raw: unknown, isNumber: boolean): ExtractedField {
  if (!raw || typeof raw !== "object") return { value: null, confidence: 0 };
  const { value, confidence } = raw as { value?: unknown; confidence?: unknown };
  if (value === null || value === undefined || value === "") {
    return { value: null, confidence: 0 };
  }
  if (isNumber) {
    const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(num)
      ? { value: num, confidence: clamp01(confidence) }
      : { value: null, confidence: 0 };
  }
  return { value: String(value), confidence: clamp01(confidence) };
}

export function parseReaderOutput(text: string, config: ClaimConfig): ReaderResult {
  // Models sometimes wrap JSON in code fences; strip them.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const json = JSON.parse(cleaned) as Record<string, unknown>;
  const result: ReaderResult = {};
  for (const key of config.fields) {
    result[key] = parseField(json[key], key === "amount");
  }
  return result;
}

// Photos and screenshots can be enhanced for a second look. PDFs and HEIC are read as they are.
export function canEnhance(type: string): boolean {
  return /^image\/(jpeg|png|webp)$/.test(type);
}

// The Reader's second look: a contrast-boosted copy, which brings out faded or
// light print that the first pass was unsure about. Returns null if it can't.
async function enhanceForRetry(bytes: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(bytes)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .grayscale()
      // Adaptive local contrast: lifts faded print without distorting the page.
      .clahe({ width: 40, height: 40, maxSlope: 12 })
      .normalise()
      .sharpen()
      .png()
      .toBuffer();
  } catch (e) {
    console.error("Image enhancement failed, re-reading the original:", e);
    return null;
  }
}

// focus: when the Auditor sends the receipt back, re-read these fields carefully,
// using an enhanced copy of the image when possible.
export async function runReader(
  file: File,
  config: ClaimConfig,
  focus: ReceiptFieldName[] = [],
): Promise<ReaderResult> {
  const retrying = focus.length > 0;
  const userText = retrying
    ? `Extract the fields from this receipt. A reviewer found these fields unclear: ${focus.join(", ")}. Look at the receipt again very carefully for them. If they are truly not visible, return null with confidence 0.`
    : "Extract the fields from this receipt.";
  let bytes: Buffer = Buffer.from(await file.arrayBuffer());
  let mime = file.type;
  if (retrying && canEnhance(file.type)) {
    const enhanced = await enhanceForRetry(bytes);
    if (enhanced) {
      bytes = enhanced;
      mime = "image/png";
    }
  }
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

  const completion = await chatCompletion({
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(config) },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("Reader got an empty response from the model");
  return parseReaderOutput(text, config);
}
