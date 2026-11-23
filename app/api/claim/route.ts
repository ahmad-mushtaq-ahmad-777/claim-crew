import type { PipelineEvent } from "@/lib/claim-types";
import { describeError } from "@/lib/errors";
import { runClaimPipeline } from "@/lib/orchestrator";

// Allow the multi-agent run (with retries) to take up to 2 minutes.
export const maxDuration = 120;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

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

  // Stream one JSON event per line so the UI can show each agent working live.
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      // If the browser disconnects, stop writing instead of throwing.
      const emit = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      // Remember which agent was working, so a failure can point at it.
      let working: "reader" | "auditor" | undefined;
      const track = (event: PipelineEvent) => {
        if (event.type === "agent_start") working = event.agent;
        if (event.type === "agent_done") working = undefined;
        emit(event);
      };
      try {
        await runClaimPipeline(receipt, track);
      } catch (e) {
        console.error("Claim pipeline failed:", e);
        const { message, hint } = describeError(e);
        emit({ type: "error", message, hint, agent: working });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
