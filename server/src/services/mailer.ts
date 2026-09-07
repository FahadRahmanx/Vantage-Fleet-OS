import nodemailer from "nodemailer";

// Real SMTP when configured; otherwise a non-sending "json transport" that
// resolves successfully without a network call. This is what lets both
// test-engine.ts (in-process) and smoke-test-http.ts (a separate `npm run
// dev` process) run without real credentials, while production delivery
// only needs SMTP_HOST/PORT/USER/PASS set.
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

const FROM = process.env.SMTP_FROM || "Vantage Fleet OS <no-reply@vantage-fleet.local>";

/**
 * sendInviteEmail — FR-6's emailed invite link. Plain text (no HTML
 * template system exists in this codebase). Throws on failure — callers
 * (services/users.ts) let that surface as a 502, per spec §8, rather than
 * silently leaving an invited user with no way to know they were invited.
 */
export async function sendInviteEmail(to: string, name: string, acceptUrl: string, isResend: boolean): Promise<void> {
  const subject = isResend ? "Reminder: your Vantage Fleet OS invitation" : "You're invited to Vantage Fleet OS";
  const text = `Hi ${name},\n\n` +
    `${isResend ? "This is a reminder that you've" : "You've"} been invited to join Vantage Fleet OS.\n\n` +
    `Set your password to activate your account:\n${acceptUrl}\n\n` +
    `This link expires in 7 days.`;

  await transporter.sendMail({ from: FROM, to, subject, text });
}
