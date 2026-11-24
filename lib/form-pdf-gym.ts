import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReaderResult } from "./claim-types";
import { fit, formatAmount, formatDate } from "./form-pdf";
import { CLAIM_CONFIGS, reimbursableAmount } from "./claim-configs";

// Recreates the company "Health Club Expense Sheet" (A4, 5-column table).
// Column proportions are taken from the original Word form.
const COMPANY_LINE_1 = "EXAMPLE COMPANY";
const COMPANY_LINE_2 = "INTERNATIONAL";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const TABLE_W = 486;
const LEFT = (PAGE_W - TABLE_W) / 2;
const RIGHT = LEFT + TABLE_W;
const COL_TWIPS = [1615, 1530, 1800, 2070, 2700];
const TWIPS_TOTAL = COL_TWIPS.reduce((a, b) => a + b, 0);
const COL_W = COL_TWIPS.map((t) => (t / TWIPS_TOTAL) * TABLE_W);
const COL_X = COL_W.reduce<number[]>(
  (acc, w, i) => [...acc, i === 0 ? LEFT : acc[i - 1] + COL_W[i - 1]],
  [],
);
const ITEM_ROWS = 10;
const BLACK = rgb(0, 0, 0);

export async function generateHealthClubPdf(
  fields: ReaderResult,
  designation = "",
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Health Club Expense Sheet");
  pdf.setCreator("ClaimCrew Form Filler");
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const text = (k: string) => {
    const val = fields[k]?.value;
    return val === null || val === undefined ? "" : String(val);
  };
  const beneficiary = text("beneficiary");
  const receiptDate = formatDate(fields.date?.value ?? null);
  const dues = typeof fields.amount?.value === "number" ? fields.amount.value : null;
  const reimbursable =
    dues === null ? null : reimbursableAmount(dues, CLAIM_CONFIGS.gym);

  let top = PAGE_H - 56;

  const rect = (x: number, y: number, w: number, h: number) =>
    page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: 0.9 });
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.9, color: BLACK });

  const textIn = (
    p: PDFPage, value: string, x: number, w: number, rowTop: number, rowH: number,
    opts: { font?: PDFFont; size?: number; align?: "left" | "center" | "right" } = {},
  ) => {
    if (!value) return;
    const f = opts.font ?? font;
    const fitted = fit(f, value, w - 8, opts.size ?? 10.5);
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
  textIn(page, COMPANY_LINE_1, COL_X[3], COL_W[3] + COL_W[4], top, 20, { font: bold, size: 14, align: "right" });
  top -= 20;
  textIn(page, COMPANY_LINE_2, COL_X[3], COL_W[3] + COL_W[4], top, 18, { font: bold, size: 14, align: "right" });
  top -= 18;

  // --- Title ---
  textIn(page, "Health Club Expense Sheet", LEFT, TABLE_W, top, 26, { font: bold, size: 13 });
  top -= 26 + 8;

  // --- Name / Designation / Date, each a label followed by a line ---
  const headRowH = 22;
  const labelled = (label: string, value: string, x1: number, x2: number) => {
    const lw = bold.widthOfTextAtSize(label, 11);
    page.drawText(label, { x: x1, y: top - headRowH + 6, size: 11, font: bold, color: BLACK });
    const lx = x1 + lw + 5;
    line(lx, top - headRowH + 3, x2, top - headRowH + 3);
    const f = fit(font, value, x2 - lx - 4, 11);
    if (f.text) page.drawText(f.text, { x: lx + 2, y: top - headRowH + 6, size: f.size, font, color: BLACK });
  };
  labelled("Name:", beneficiary, LEFT + 4, LEFT + 190);
  labelled("Designation:", designation, LEFT + 202, LEFT + 358);
  labelled("Date:", receiptDate, LEFT + 370, RIGHT - 4);
  top -= headRowH + 8;

  // --- Table header (two-line labels) ---
  const headers = [
    ["Date"],
    ["Membership Dues", "For The Month Of"],
    ["Name Of The", "Health Club"],
    ["Monthly Membership", "Dues (Rs.)"],
    ["Reimbursable Amount", "(60% Of The Dues)"],
  ];
  const headH = 34;
  headers.forEach((lines, i) => {
    rect(COL_X[i], top - headH, COL_W[i], headH);
    lines.forEach((ln, j) => {
      const f = fit(bold, ln, COL_W[i] - 8, 9.5);
      const tw = bold.widthOfTextAtSize(f.text, f.size);
      page.drawText(f.text, {
        x: COL_X[i] + (COL_W[i] - tw) / 2,
        y: top - headH / 2 + (lines.length - 1) * 6 - j * 12 - 3.5,
        size: f.size, font: bold, color: BLACK,
      });
    });
  });
  top -= headH;

  // --- Item rows (only the first is filled) ---
  const rowH = 22;
  const first = [
    receiptDate,
    text("month"),
    text("healthClub"),
    formatAmount(dues),
    reimbursable === null ? "" : formatAmount(reimbursable),
  ];
  for (let r = 0; r < ITEM_ROWS; r++) {
    COL_W.forEach((w, i) => {
      rect(COL_X[i], top - rowH, w, rowH);
      if (r === 0) textIn(page, first[i], COL_X[i], w, top, rowH, { size: 10 });
    });
    top -= rowH;
  }

  // --- Total row: label before the boxed reimbursable total ---
  textIn(page, "Total", COL_X[3], COL_W[3], top, rowH, { font: bold, size: 11 });
  rect(COL_X[4], top - rowH, COL_W[4], rowH);
  textIn(page, reimbursable === null ? "" : formatAmount(reimbursable), COL_X[4], COL_W[4], top, rowH, { font: bold, size: 10 });
  top -= rowH;

  // --- Signature row: name above the line, labels below ---
  const sigGap = 34;
  const sigBottom = top - sigGap;
  textIn(page, beneficiary, COL_X[0], COL_W[0] + COL_W[1], top, sigGap, { size: 10 });
  line(COL_X[0], sigBottom, COL_X[0] + COL_W[0] + COL_W[1], sigBottom);
  line(COL_X[3], sigBottom, RIGHT, sigBottom);
  top = sigBottom;
  const labelH = 18;
  textIn(page, "Employee Signature", COL_X[0], COL_W[0] + COL_W[1], top, labelH, { size: 8.5 });
  textIn(page, "Approved By", COL_X[3], COL_W[3] + COL_W[4], top, labelH, { size: 8.5 });
  top -= labelH + 14;

  // --- Footer note ---
  page.drawText("Receipted bills to be attached", {
    x: LEFT + 4, y: top - 10, size: 10, font, color: BLACK,
  });

  return pdf.save();
}
