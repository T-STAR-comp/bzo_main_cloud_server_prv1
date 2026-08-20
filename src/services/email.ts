import { sendMail } from "./mailer.js";
import { logger } from "../logger.js";
import { renderEmailWithFooter } from "./emailHtmlTemplate.js";

const subjectMap = {
  signup: "Verify your Biazo account",
  login: "Your Biazo sign-in code",
  password_reset: "Reset your Biazo password",
} as const;

const titleMap = {
  signup: "Verify your email",
  login: "Your sign-in code",
  password_reset: "Reset your password",
} as const;

function logEmailCode(to: string, code: string, purpose: keyof typeof subjectMap) {
  logger.info(`[email-code] ${purpose} verification code for ${to}: ${code}`);
}

export async function sendEmailCode(
  to: string,
  code: string,
  purpose: "signup" | "login" | "password_reset",
) {
  logEmailCode(to, code, purpose);

  const intro =
    purpose === "password_reset"
      ? "Use this code to reset your Biazo password:"
      : "Your Biazo verification code is:";

  const text = `
${intro} ${code}

This code expires in 15 minutes. If you did not request this, you can ignore this email.

- Biazo Travel Agency, Lilongwe, Malawi
`.trim();

  const { html } = await renderEmailWithFooter({
    preheader: `Your code is ${code}`,
    title: titleMap[purpose],
    bodyText:
      purpose === "password_reset"
        ? "Enter this code on the password reset page. It expires in 15 minutes."
        : "Enter this code to continue. It expires in 15 minutes. If you did not request this, you can safely ignore this email.",
    highlightHtml: `<span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:0.35em;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#0f172a;">${code}</span>`,
  });

  try {
    await sendMail({ to, subject: subjectMap[purpose], text, html });
    logger.info(`Email delivered to ${to}`, { purpose });
  } catch (error) {
    logger.error(`SMTP delivery failed for ${to} (${purpose}) - code logged above`, error);
  }
}
