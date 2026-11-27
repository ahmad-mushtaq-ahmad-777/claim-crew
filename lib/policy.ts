// Fictional reimbursement policy for the demo (made-up data only).
// Per-claim-type rules (monthly cap, reimbursement rate) live in claim-configs.ts.
export const POLICY = {
  // Receipt year must equal the current year (no past or future years).
  allowedYear: "current",
  // Below this confidence the Auditor asks the Reader to re-read a field.
  minConfidence: 0.7,
  // Fields with their own, lower bar. The beneficiary name is a printed label rather than a
  // number being reimbursed, and models report lower confidence on it for faded print.
  minConfidenceByField: { beneficiary: 0.5 } as Record<string, number>,
  // Below this the Classifier is not sure enough what kind of receipt it is.
  minClassifyConfidence: 0.6,
  // Max times the Auditor may send the receipt back to the Reader.
  maxRetries: 2,
} as const;
