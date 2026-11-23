// Fields the internet reimbursement form needs from a receipt.
// "Number", signatures and approvals are intentionally NOT extracted.
export const RECEIPT_FIELDS = [
  "beneficiary",
  "serviceProvider",
  "date",
  "month",
  "natureOfExpense",
  "amount",
] as const;

export type ReceiptFieldName = (typeof RECEIPT_FIELDS)[number];

export type ExtractedField = {
  // null when the field could not be found on the receipt
  value: string | number | null;
  // 0 to 1: how sure the Reader is about this value
  confidence: number;
};

export type ReaderResult = Record<ReceiptFieldName, ExtractedField>;

export type ReaderResponse = {
  agent: "reader";
  mode: "mock" | "live";
  fields: ReaderResult;
};
