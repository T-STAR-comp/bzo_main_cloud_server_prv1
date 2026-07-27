import { sendMail } from "./mailer.js";
import { logger } from "../logger.js";

const subjectMap = {
  signup: "Verify your Biazo account",
  login: "Your Biazo sign-in code",
  password_reset: "Reset your Biazo password",
} as const;

function logEmailCode(to: string, code: string, purpose: keyof typeof subjectMap) {
  logger.info(`[email-code] ${purpose} verification code for ${to}: ${code}`);
}

export async function sendEmailCode(
  to: string,
  code: string,
  purpose: "signup" | "login" | "password_reset",
) {
  // Always log the code first — dev fallback and audit trail if SMTP fails.
  logEmailCode(to, code, purpose);

  const intro =
    purpose === "password_reset"
      ? "Use this code to reset your Biazo password:"
      : "Your Biazo verification code is:";

  const body = `
${intro} ${code}

This code expires in 15 minutes. If you did not request this, you can ignore this email.

— Biazo Travel Agency, Lilongwe, Malawi
`.trim();

  try {
    await sendMail({ to, subject: subjectMap[purpose], text: body });
    logger.info(`Email delivered to ${to}`, { purpose });
  } catch (error) {
    logger.error(`SMTP delivery failed for ${to} (${purpose}) — code logged above`, error);
  }
}
