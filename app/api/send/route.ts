import { verifyDraft } from "@/lib/draft-signing";
import { draftToHtml } from "@/lib/email-html";
import { accountsAddress, sendMail } from "@/lib/mailer";

export const maxDuration = 60;

const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BASE64 = 512 * 1024; // keeps receipt + form under Vercel's 4.5 MB body cap
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

// Best-effort abuse limits (per server instance): per IP per hour, and a daily total.
const PER_IP_LIMIT = 100;
const DAILY_LIMIT = 250;
const hits = new Map<string, number[]>();
let day = { key: "", count: 0 };

function rateLimited(ip: string): string | null {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (day.count >= DAILY_LIMIT) return "The daily demo sending limit has been reached. Try again tomorrow.";
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_LIMIT) return "Too many emails sent from your connection. Try again in an hour.";
  recent.push(now);
  hits.set(ip, recent);
  day.count += 1;
  return null;
}

// A failed send (e.g. Gmail timeout) must not use up the user's allowance.
function refund(ip: string) {
  const list = hits.get(ip);
  if (list?.length) list.pop();
  if (day.count > 0) day.count -= 1;
}

function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").slice(0, 100).trim();
  return cleaned || fallback;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const receipt = form.get("receipt");
  const cc = String(form.get("cc") ?? "").trim();
  const subject = String(form.get("subject") ?? "");
  const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n");
  const pdfBase64 = String(form.get("pdfBase64") ?? "");
  const pdfFilename = String(form.get("pdfFilename") ?? "");
  const signature = String(form.get("signature") ?? "");

  if (!EMAIL_RE.test(cc) || cc.length > 254) {
    return Response.json({ error: "Enter one valid CC email address." }, { status: 400 });
  }
  if (!(receipt instanceof File) || !ALLOWED_TYPES.includes(receipt.type)) {
    return Response.json({ error: "The receipt file is missing or not allowed." }, { status: 400 });
  }
  if (receipt.size > MAX_RECEIPT_BYTES) {
    return Response.json({ error: "Receipt must be 4 MB or smaller." }, { status: 413 });
  }
  if (!pdfBase64 || pdfBase64.length > MAX_PDF_BASE64) {
    return Response.json({ error: "The expense sheet is missing or too large." }, { status: 400 });
  }
  // Only the exact draft the Dispatcher wrote may be sent.
  if (!subject || !body || !verifyDraft(subject, body, pdfBase64, signature)) {
    return Response.json({ error: "This draft was not approved by the Dispatcher." }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = rateLimited(ip);
  if (limited) return Response.json({ error: limited }, { status: 429 });

  try {
    const info = await sendMail({
      to: accountsAddress(),
      cc,
      subject,
      text: body,
      html: draftToHtml(body),
      attachments: [
        {
          filename: safeName(receipt.name, "receipt"),
          content: Buffer.from(await receipt.arrayBuffer()),
          contentType: receipt.type,
        },
        {
          filename: safeName(pdfFilename, "Internet-Expense-Sheet.pdf"),
          content: Buffer.from(pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ],
    });
    return Response.json({ ok: true, messageId: info.messageId, cc });
  } catch (e) {
    console.error("Send failed", e);
    refund(ip);
    const text = e instanceof Error ? e.message : "";
    const code = (e as { code?: string })?.code ?? "";
    const timedOut = code === "ETIMEDOUT" || code === "ESOCKET" || /timeout/i.test(text);
    const d = timedOut
      ? {
          message: "We couldn't confirm that the email was delivered.",
          hint: "The mail server was slow to reply, but the email may still have gone through. Check your CC inbox before trying again.",
        }
      : {
          message: "The email could not be sent.",
          hint: "Please try again in a moment. If it keeps failing, tell the app owner.",
        };
    return Response.json({ error: d.message, hint: d.hint }, { status: 502 });
  }
}
