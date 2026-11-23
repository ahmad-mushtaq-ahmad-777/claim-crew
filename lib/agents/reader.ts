import {
  RECEIPT_FIELDS,
  type ExtractedField,
  type ReaderResult,
  type ReceiptFieldName,
} from "@/lib/claim-types";
import { getLLM } from "@/lib/llm";

const SYSTEM_PROMPT = `You are the Reader agent in an expense-claim system.
You receive one internet/mobile bill receipt (image or PDF) and extract ONLY these fields:
- beneficiary: the customer / account holder name on the bill
- serviceProvider: the company that issued the bill
- date: the bill or payment date, formatted YYYY-MM-DD
- month: the billing month as the full month name only, e.g. "November" (no year)
- natureOfExpense: short description, e.g. "Internet bill"
- amount: the total amount payable as a number, no currency symbol

Rules:
- Never invent values. If a field is not visible, use null with confidence 0.
- confidence is a number from 0 to 1 for how sure you are about that value.
- Respond with JSON only, in exactly this shape:
{"beneficiary":{"value":...,"confidence":...},"serviceProvider":{...},"date":{...},"month":{...},"natureOfExpense":{...},"amount":{...}}`;

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

export function parseReaderOutput(text: string): ReaderResult {
  // Models sometimes wrap JSON in code fences; strip them.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const json = JSON.parse(cleaned) as Record<string, unknown>;
  const result = {} as ReaderResult;
  for (const key of RECEIPT_FIELDS) {
    result[key] = parseField(json[key], key === "amount");
  }
  return result;
}

export function mockReaderFields(): ReaderResult {
  return {
    beneficiary: { value: "Jane Doe", confidence: 0.95 },
    serviceProvider: { value: "Example ISP", confidence: 0.97 },
    date: { value: "2026-11-05", confidence: 0.93 },
    month: { value: "November", confidence: 0.9 },
    natureOfExpense: { value: "Internet bill", confidence: 0.96 },
    amount: { value: 4500, confidence: 0.98 },
  };
}

// focus: when the Auditor sends the receipt back, re-read these fields carefully.
export async function runReader(
  file: File,
  focus: ReceiptFieldName[] = [],
): Promise<ReaderResult> {
  const { client, model } = getLLM();
  const userText =
    focus.length > 0
      ? `Extract the fields from this receipt. A reviewer found these fields unclear: ${focus.join(", ")}. Look at the receipt again very carefully for them. If they are truly not visible, return null with confidence 0.`
      : "Extract the fields from this receipt.";
  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
  return parseReaderOutput(text);
}
