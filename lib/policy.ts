// Fictional reimbursement policy for the demo (made-up data only).
export const POLICY = {
  // Maximum Accounts reimburses per month. The form still shows the full invoice amount.
  monthlyCap: 2000,
  // Receipt year must equal the current year (no past or future years).
  allowedYear: "current",
  // Below this confidence the Auditor asks the Reader to re-read a field.
  minConfidence: 0.7,
  // Max times the Auditor may send the receipt back to the Reader.
  maxRetries: 2,
  // Expense types this form accepts.
  allowedExpense: "internet/mobile bill",
} as const;
