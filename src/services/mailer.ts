import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "../logger.js";

const transporter =
  config.smtp.host && config.smtp.user
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    : null;

export async function sendMail(options: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}) {
  logger.info(`[email] ${options.subject} → ${Array.isArray(options.to) ? options.to.join(", ") : options.to}`);
  logger.info(`[email-body]\n${options.text}`);

  if (!transporter) {
    logger.warn("SMTP not configured - email logged above only");
    return;
  }

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });
  } catch (error) {
    logger.error("SMTP delivery failed", error);
  }
}

export { transporter };
