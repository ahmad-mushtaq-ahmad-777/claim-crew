import { CLAIM_CONFIGS } from "@/lib/claim-configs";
import type { Classification, ClaimTypeId } from "@/lib/claim-types";
import { chatCompletion } from "@/lib/llm";

const IDS = Object.keys(CLAIM_CONFIGS) as ClaimTypeId[];
const TYPES: (ClaimTypeId | "unknown")[] = [...IDS, "unknown"];
const TYPE_UNION = TYPES.map((t) => `"${t}"`).join("|");

// Built from CLAIM_CONFIGS, so a new claim type is picked up automatically.
const SYSTEM_PROMPT = `You are the Classifier agent in an expense-claim system.
You receive one receipt (image or PDF) and decide what kind of claim it is:
${IDS.map((id) => `- "${id}": ${CLAIM_CONFIGS[id].classifyHint}`).join("\n")}
- "unknown": anything else, or you cannot tell

Rules:
- Decide only from what is visible. Never guess.
- confidence is a number from 0 to 1 for how sure you are.
- reason is ONE short sentence on what you saw (provider or club name, what was paid for).
- Respond with JSON only, in exactly this shape:
{"type":${TYPE_UNION},"confidence":0.0,"reason":"..."}`;

export function parseClassification(text: string): Classification {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const json = JSON.parse(cleaned) as Record<string, unknown>;
  const type = TYPES.includes(json.type as ClaimTypeId)
    ? (json.type as Classification["type"])
    : "unknown";
  const conf = Number(json.confidence);
  return {
    type,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    reason: typeof json.reason === "string" ? json.reason.slice(0, 200) : "",
  };
}

export async function runClassifier(file: File): Promise<Classification> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;

  const completion = await chatCompletion(
    {
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "What kind of claim is this receipt?" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    },
    // A small decision: fail over quickly if a model is slow.
    { timeout: 20_000 },
  );

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("Classifier got an empty response from the model");
  return parseClassification(text);
}
