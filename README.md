# ClaimCrew

ClaimCrew is a multi-agent receipt-to-reimbursement demo built for the SSI Agent-A-Thon. It turns an internet bill or health club receipt into a ready-to-send reimbursement claim: the app classifies the receipt, extracts the required fields, audits the claim against policy, fills the company form, and drafts the email to Accounts for final approval.

The demo uses made-up sample data only. Emails are sent only after the user reviews the draft and clicks Approve & Send.

## 5-Agent Flow

1. **Classifier** decides whether the receipt is an internet bill, a health club receipt, or an unsupported document.
2. **Reader** extracts the required fields for the detected claim type. If required fields are missing or low-confidence, it retries with a focused re-read.
3. **Auditor** checks the extracted claim against policy, including confidence, year, expense type, amount, and claim-type caps.
4. **Form Filler** generates the completed reimbursement PDF for the detected claim type.
5. **Dispatcher** drafts the Accounts email and signs the draft so only approved drafts can be sent.

## Supported Claims

- **Internet bills**: reimburses up to the internet policy cap.
- **Health club memberships**: calculates 60% of monthly dues, shows the full dues and reimbursable amount on the form, and flags over-cap claims for Accounts.

## Stack

- **Framework**: Next.js App Router, React, TypeScript
- **UI**: Tailwind CSS
- **LLM**: OpenAI-compatible API through the `openai` SDK
- **PDF generation**: `pdf-lib`
- **Email**: Gmail SMTP through `nodemailer`
- **Image processing**: `sharp`
- **Deployment**: Vercel

## Environment Variables

Create `.env.local` for local development and set the same values in Vercel for deployment. Do not commit secrets.

```bash
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
LLM_FALLBACK_MODELS=
MOCK_LLM=false

GMAIL_USER=
GMAIL_APP_PASSWORD=
ACCOUNTS_EMAIL=
DISPATCH_SIGNING_SECRET=
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Useful Scripts

```bash
npm run dev
npm run build
npx tsc --noEmit
npx eslint app lib components
```

## Notes

- Sample receipts live in `public/samples` and use made-up data.
- The app requires the user to enter a designation before starting a claim.
- The CC email is required at the approval step so the user receives a copy of the exact email sent to Accounts.
- Real API keys and Gmail app passwords must stay in `.env.local` or Vercel environment variables.
