import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function signingSecret(): string {
  const secret = process.env.DRAFT_SIGNING_SECRET?.trim();
  if (!secret) {
    throw new Error("DRAFT_SIGNING_SECRET must be set to sign or verify email drafts");
  }
  return secret;
}

// Signs a draft so the send step can only send exactly what the Dispatcher wrote.
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// Browsers turn "\n" into "\r\n" in multipart uploads, so ignore that difference.
const normalize = (s: string) => s.replace(/\r\n/g, "\n");

export function signDraft(subject: string, body: string, pdfBase64: string): string {
  return createHmac("sha256", signingSecret())
    .update(
      JSON.stringify({
        subject: normalize(subject),
        body: normalize(body),
        pdf: sha256(pdfBase64),
      }),
    )
    .digest("hex");
}

export function verifyDraft(
  subject: string,
  body: string,
  pdfBase64: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signDraft(subject, body, pdfBase64));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}