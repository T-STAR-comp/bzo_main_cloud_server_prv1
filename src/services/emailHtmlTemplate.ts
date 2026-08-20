import { getPlatformSettings } from "./platformSettings.js";
import { config } from "../config.js";

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtmlParagraphs(text: string) {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length === 1) {
        return `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#334155;">${escapeHtml(lines[0]!)}</p>`;
      }
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#334155;">${lines.map((line) => escapeHtml(line)).join("<br/>")}</p>`;
    })
    .join("");
}

export type EmailButton = {
  label: string;
  href: string;
};

export type EmailHtmlOptions = {
  preheader?: string;
  title: string;
  greeting?: string;
  bodyText: string;
  bullets?: string[];
  highlightHtml?: string;
  button?: EmailButton;
  footerText?: string;
};

export async function getEmailFooterParts() {
  const settings = await getPlatformSettings();
  const wa = settings.whatsappNumber.replace(/\D/g, "");
  return {
    conciergePhone: settings.conciergePhone,
    whatsappUrl: `https://wa.me/${wa}`,
    text: `\n\n- Biazo Travel Agency, Lilongwe, Malawi\nConcierge: ${settings.conciergePhone} · WhatsApp: https://wa.me/${wa}`,
  };
}

export function renderEmailHtml(options: EmailHtmlOptions) {
  const origin = config.clientOrigins[0] ?? "https://biazo.net";
  const preheader = options.preheader ?? options.title;
  const greeting = options.greeting
    ? `<p style="margin:0 0 16px;font-size:17px;line-height:1.5;color:#0f172a;font-weight:600;">${escapeHtml(options.greeting)}</p>`
    : "";
  const bullets =
    options.bullets && options.bullets.length
      ? `<ul style="margin:0 0 20px;padding:0 0 0 20px;color:#334155;font-size:15px;line-height:1.7;">${options.bullets
          .map((item) => `<li style="margin-bottom:8px;">${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : "";
  const highlight = options.highlightHtml
    ? `<div style="margin:0 0 20px;padding:16px 18px;border-radius:12px;background:#f0f9ff;border:1px solid #bae6fd;color:#0c4a6e;font-size:15px;line-height:1.6;">${options.highlightHtml}</div>`
    : "";
  const button = options.button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;">
        <tr>
          <td style="border-radius:999px;background:#0d9488;">
            <a href="${escapeHtml(options.button.href)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(options.button.label)}</a>
          </td>
        </tr>
      </table>`
    : "";
  const footer = options.footerText
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(options.footerText).replace(/\n/g, "<br/>")}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 8px 30px rgba(15,23,42,0.06);">
          <tr>
            <td style="padding:28px 32px 20px;background:linear-gradient(135deg,#0f172a 0%,#134e4a 100%);">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#5eead4;">Biazo Travel</p>
              <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">${escapeHtml(options.title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 32px;">
              ${greeting}
              ${textToHtmlParagraphs(options.bodyText)}
              ${highlight}
              ${bullets}
              ${button}
              ${footer}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#64748b;">
                Biazo Travel Agency · Lilongwe, Malawi<br/>
                <a href="${origin}" style="color:#0d9488;text-decoration:none;">${escapeHtml(origin.replace(/^https?:\/\//, ""))}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function renderEmailWithFooter(options: Omit<EmailHtmlOptions, "footerText"> & { footerText?: string }) {
  const footerParts = await getEmailFooterParts();
  const footerText =
    options.footerText ??
    `Need help? Call ${footerParts.conciergePhone} or message us on WhatsApp.`;
  return {
    html: renderEmailHtml({ ...options, footerText }),
    footerLine: footerParts.text,
  };
}
