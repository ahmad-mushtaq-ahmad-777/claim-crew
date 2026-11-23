import nodemailer from "nodemailer";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type OutgoingMail = {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
};

function getMailConfig() {
  const user = process.env.GMAIL_USER;
  // Google shows app passwords in groups of four; spaces are not part of it.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const accounts = process.env.ACCOUNTS_EMAIL;
  if (!user || !pass || !accounts) {
    throw new Error("GMAIL_USER, GMAIL_APP_PASSWORD and ACCOUNTS_EMAIL must be set to send email");
  }
  return { user, pass, accounts };
}

export function accountsAddress(): string {
  return getMailConfig().accounts;
}

function transporter() {
  const { user, pass } = getMailConfig();
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

// Checks the Gmail login without sending anything.
export async function verifyMailer(): Promise<void> {
  await transporter().verify();
}

export async function sendMail(mail: OutgoingMail) {
  const { user } = getMailConfig();
  return transporter().sendMail({
    from: `"ClaimCrew (demo)" <${user}>`,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });
}
