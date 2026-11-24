import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReaderResult } from "./claim-types";

// Recreates the company "Internet Expense Sheet" (US Letter, 7-column table).
// Column proportions are taken from the original Word form.
const COMPANY_LINE_1 = "EXAMPLE COMPANY";
const COMPANY_LINE_2 = "INTERNATIONAL";

const PAGE_W = 612;
const PAGE_H = 792;
const TABLE_W = 540;
const LEFT = (PAGE_W - TABLE_W) / 2;
const COL_TWIPS = [1638, 1710, 1350, 1530, 2070, 2189, 1070];
const TWIPS_TOTAL = COL_TWIPS.reduce((a, b) => a + b, 0);
const COL_W = COL_TWIPS.map((t) => (t / TWIPS_TOTAL) * TABLE_W);
const COL_X = COL_W.reduce<number[]>(
  (acc, w, i) => [...acc, i === 0 ? LEFT : acc[i - 1] + COL_W[i - 1]],
  [],
);
const RIGHT = LEFT + TABLE_W;
const ITEM_ROWS = 14;
const BLACK = rgb(0, 0, 0);

export function formatDate(value: string | number | null): string {
  if (value === null) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

export function formatAmount(value: string | number | null): string {
  if (typeof value !== "number") return value === null ? "" : String(value);
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Shrink text to fit a width; truncate with an ellipsis only as a last resort.
export function fit(font: PDFFont, text: string, maxWidth: number, size: number, min = 6) {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, s) > maxWidth) {
    t = t.slice(0, -2) + "…";
  }
  return { text: t, size: s };
}

export async function generateFormPdf(fields: ReaderResult): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Internet Expense Sheet");
  pdf.setCreator("ClaimCrew Form Filler");
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const v = (k: keyof ReaderResult) => fields[k].value;
  const beneficiary = v("beneficiary") === null ? "" : String(v("beneficiary"));
  const receiptDate = formatDate(v("date"));
  const amountNum = typeof v("amount") === "number" ? (v("amount") as number) : null;

  let top = PAGE_H - 56; // y of the current row's top edge

  const rect = (x: number, y: number, w: number, h: number) =>
    page.drawRectangle({
      x, y, width: w, height: h,
      borderColor: BLACK, borderWidth: 0.9,
    });

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.9, color: BLACK });

  // Draw text vertically centred in a row, aligned inside [x, x+w].
  const textIn = (
    p: PDFPage, text: string, x: number, w: number, rowTop: number, rowH: number,
    opts: { font?: PDFFont; size?: number; align?: "left" | "center" | "right" } = {},
  ) => {
    if (!text) return;
    const f = opts.font ?? font;
    const fitted = fit(f, text, w - 8, opts.size ?? 10.5);
    const tw = f.widthOfTextAtSize(fitted.text, fitted.size);
    const align = opts.align ?? "center";
    const tx = align === "center" ? x + (w - tw) / 2 : align === "right" ? x + w - tw - 4 : x + 4;
    p.drawText(fitted.text, {
      x: tx,
      y: rowTop - rowH + (rowH - fitted.size) / 2 + fitted.size * 0.18,
      size: fitted.size, font: f, color: BLACK,
    });
  };

  // --- Company name (top right) ---
  textIn(page, COMPANY_LINE_1, COL_X[5], COL_W[5] + COL_W[6], top, 20, { font: bold, size: 14, align: "right" });
  top -= 20;
  textIn(page, COMPANY_LINE_2, COL_X[5], COL_W[5] + COL_W[6], top, 18, { font: bold, size: 14, align: "right" });
  top -= 18;

  // --- Title ---
  textIn(page, "Internet Expense Sheet", LEFT, TABLE_W, top, 26, { font: bold, size: 13 });
  top -= 26 + 8;

  // --- Name / Date ---
  const nameRowH = 22;
  const nameLabelW = bold.widthOfTextAtSize("Name:", 11);
  page.drawText("Name:", { x: LEFT + 4, y: top - nameRowH + 6, size: 11, font: bold, color: BLACK });
  const nameX = LEFT + 4 + nameLabelW + 6;
  const nameEnd = COL_X[3] - 6;
  line(nameX, top - nameRowH + 3, nameEnd, top - nameRowH + 3);
  const nameFit = fit(font, beneficiary, nameEnd - nameX - 4, 11);
  if (nameFit.text) page.drawText(nameFit.text, { x: nameX + 2, y: top - nameRowH + 6, size: nameFit.size, font, color: BLACK });

  const dateLabelW = bold.widthOfTextAtSize("Date:", 11);
  const dateLabelX = COL_X[4] + 4;
  page.drawText("Date:", { x: dateLabelX, y: top - nameRowH + 6, size: 11, font: bold, color: BLACK });
  const dateX = dateLabelX + dateLabelW + 6;
  line(dateX, top - nameRowH + 3, RIGHT - 4, top - nameRowH + 3);
  const dateFit = fit(font, receiptDate, RIGHT - 4 - dateX - 4, 11);
  if (dateFit.text) page.drawText(dateFit.text, { x: dateX + 2, y: top - nameRowH + 6, size: dateFit.size, font, color: BLACK });
  top -= nameRowH + 8;

  // --- Table header ---
  const headers = ["Beneficiary", "Service Provider", "Date", "Month", "Nature of Expense", "Number", "Amount"];
  const headH = 22;
  headers.forEach((h, i) => {
    rect(COL_X[i], top - headH, COL_W[i], headH);
    textIn(page, h, COL_X[i], COL_W[i], top, headH, { font: bold, size: 9.5 });
  });
  top -= headH;

  // --- Item rows (only the first is filled; "Number" stays blank) ---
  const rowH = 20;
  const first = [
    beneficiary,
    v("serviceProvider") === null ? "" : String(v("serviceProvider")),
    receiptDate,
    v("month") === null ? "" : String(v("month")),
    v("natureOfExpense") === null ? "" : String(v("natureOfExpense")),
    "", // Number: intentionally left empty
    formatAmount(v("amount")),
  ];
  for (let r = 0; r < ITEM_ROWS; r++) {
    COL_W.forEach((w, i) => {
      rect(COL_X[i], top - rowH, w, rowH);
      if (r === 0) textIn(page, first[i], COL_X[i], w, top, rowH, { size: 10 });
    });
    top -= rowH;
  }

  // --- Total row: label under "Number", boxed amount under "Amount" ---
  textIn(page, "Total", COL_X[5], COL_W[5], top, rowH, { font: bold, size: 11 });
  rect(COL_X[6], top - rowH, COL_W[6], rowH);
  textIn(page, amountNum === null ? "" : formatAmount(amountNum), COL_X[6], COL_W[6], top, rowH, { font: bold, size: 10 });
  top -= rowH;

  // --- Signature row: name above the line, labels below ---
  const sigGap = 30;
  const sigBottom = top - sigGap;
  textIn(page, beneficiary, COL_X[0], COL_W[0], top, sigGap, { size: 10 });
  // Signature lines sit on top of each label cell
  line(COL_X[0], sigBottom, COL_X[0] + COL_W[0], sigBottom);
  line(COL_X[2], sigBottom, COL_X[2] + COL_W[2], sigBottom);
  line(COL_X[4], sigBottom, COL_X[4] + COL_W[4] + COL_W[5], sigBottom);
  top = sigBottom;
  const labelH = 18;
  textIn(page, "Employee Signature", COL_X[0], COL_W[0], top, labelH, { size: 8.5 });
  textIn(page, "Checked By", COL_X[2], COL_W[2], top, labelH, { size: 8.5 });
  textIn(page, "Approved By", COL_X[4], COL_W[4] + COL_W[5], top, labelH, { size: 8.5 });
  top -= labelH + 14;

  // --- Footer note ---
  page.drawText("Kindly attach Receipted Bills", {
    x: LEFT + 4, y: top - 10, size: 10, font, color: BLACK,
  });

  return pdf.save();
}
