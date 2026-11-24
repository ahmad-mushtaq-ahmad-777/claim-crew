// Generates the made-up gym sample receipts in public/samples (a clean PDF and a faded scan).
// Run: npx tsx scripts/make-gym-samples.ts
// All names, numbers and addresses here are fictional.
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { gymReceiptSvg } from "./receipt-svg";

const W = 420;
const H = 600;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.06, 0.45, 0.4);

type Dates = { receiptNo: string; paid: string; period: string; txn: string };
const THIS_YEAR: Dates = {
  receiptNo: "IP-LHR-2026-013377",
  paid: "23 Nov 2026, 11:20 PKT",
  period: "01 Nov - 30 Nov 2026",
  txn: "TXN-5530917742",
};
const LAST_YEAR: Dates = {
  receiptNo: "IP-LHR-2025-011842",
  paid: "21 Nov 2025, 18:05 PKT",
  period: "01 Nov - 30 Nov 2025",
  txn: "TXN-4417802265",
};

async function makeReceipt(memberName: string, d: Dates = THIS_YEAR): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Iron Peak Fitness Club - Membership Payment Receipt");
  const page = pdf.addPage([W, H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const text = (
    s: string, x: number, y: number,
    o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; right?: number } = {},
  ) => {
    const f = o.bold ? bold : font;
    const size = o.size ?? 10;
    const tx = o.right !== undefined ? o.right - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: tx, y, size, font: f, color: o.color ?? INK });
  };
  const rule = (y: number) =>
    page.drawLine({ start: { x: 30, y }, end: { x: W - 30, y }, thickness: 0.6, color: rgb(0.8, 0.82, 0.85) });

  // Header band
  page.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: ACCENT });
  text("IRON PEAK FITNESS CLUB", 30, H - 44, { size: 18, bold: true, color: rgb(1, 1, 1) });
  text("Gym & Health Club", 30, H - 62, { size: 10, color: rgb(0.85, 0.95, 0.92) });
  text("Phase 5, Lahore  |  Helpline: 042-111-000-555", 30, H - 78, { size: 9, color: rgb(0.85, 0.95, 0.92) });

  text("MEMBERSHIP PAYMENT RECEIPT", 30, H - 122, { size: 13, bold: true });
  page.drawRectangle({
    x: W - 90, y: H - 128, width: 60, height: 22,
    borderColor: ACCENT, borderWidth: 1.5, color: rgb(0.93, 0.98, 0.96),
  });
  text("PAID", 0, H - 121, { size: 12, bold: true, color: ACCENT, right: W - 45 });

  const row = (label: string, value: string, y: number) => {
    text(label, 30, y, { size: 9, color: MUTED });
    text(value, 0, y, { size: 10, bold: true, right: W - 30 });
  };
  row("RECEIPT NO.", d.receiptNo, H - 152);
  row("PAYMENT DATE", d.paid, H - 170);
  row("MEMBERSHIP PERIOD", d.period, H - 188);
  rule(H - 202);

  text("MEMBER INFORMATION", 30, H - 222, { size: 9, bold: true, color: ACCENT });
  row("Member Name", memberName, H - 242);
  row("Membership ID", "IPF-20418", H - 260);
  row("Plan", "Monthly Gym Membership", H - 278);
  row("Address", "Block C, Phase 5, Lahore", H - 296);
  rule(H - 310);

  text("CHARGES", 30, H - 330, { size: 9, bold: true, color: ACCENT });
  text("DESCRIPTION", 30, H - 348, { size: 8, color: MUTED });
  text("AMOUNT (PKR)", 0, H - 348, { size: 8, color: MUTED, right: W - 30 });
  text("Monthly membership dues", 30, H - 366, { size: 10 });
  text("7,500.00", 0, H - 366, { size: 10, right: W - 30 });
  text("Admission / locker fee", 30, H - 384, { size: 10 });
  text("0.00", 0, H - 384, { size: 10, right: W - 30 });
  rule(H - 396);
  text("TOTAL AMOUNT PAID", 30, H - 418, { size: 11, bold: true });
  text("PKR 7,500.00", 0, H - 418, { size: 13, bold: true, right: W - 30 });
  rule(H - 432);

  row("Method", "Card (demo terminal)", H - 452);
  row("Transaction ID", d.txn, H - 470);

  text("This is a computer-generated receipt and does not require a signature.", 30, 60, { size: 8, color: MUTED });
  text("Made-up sample for the ClaimCrew demo. Not a real business.", 30, 46, { size: 8, color: MUTED });

  return pdf.save();
}

async function main() {
  mkdirSync("public/samples", { recursive: true });
  writeFileSync("public/samples/iron-peak-gym-receipt.pdf", await makeReceipt("Hamza Tariq"));
  // A clean, readable receipt from last year: the Auditor rejects it straight away.
  writeFileSync("public/samples/iron-peak-gym-last-year.pdf", await makeReceipt("Hamza Tariq", LAST_YEAR));
  // Same receipt as a low-quality scan with the member name printed almost invisibly.
  // The first read finds no name, the Auditor sends it back, and the Reader's second
  // look at a contrast-enhanced copy recovers it (3 of 3 live runs with these settings).
  const faded = await sharp(
    Buffer.from(gymReceiptSvg("Hamza Tariq", { fill: "#f2f3f4", blur: 0.5, size: 10 })),
  )
    .resize({ width: 420 })
    .jpeg({ quality: 70 })
    .toBuffer();
  writeFileSync("public/samples/iron-peak-gym-faded-name.jpg", faded);
  console.log("gym samples written");
}

main();
