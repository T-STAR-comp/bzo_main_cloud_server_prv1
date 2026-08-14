"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailCode = sendEmailCode;
const mailer_js_1 = require("./mailer.js");
const logger_js_1 = require("../logger.js");
const subjectMap = {
    signup: "Verify your Biazo account",
    login: "Your Biazo sign-in code",
    password_reset: "Reset your Biazo password",
};
function logEmailCode(to, code, purpose) {
    logger_js_1.logger.info(`[email-code] ${purpose} verification code for ${to}: ${code}`);
}
async function sendEmailCode(to, code, purpose) {
    // Always log the code first — dev fallback and audit trail if SMTP fails.
    logEmailCode(to, code, purpose);
    const intro = purpose === "password_reset"
        ? "Use this code to reset your Biazo password:"
        : "Your Biazo verification code is:";
    const body = `
${intro} ${code}

This code expires in 15 minutes. If you did not request this, you can ignore this email.

— Biazo Travel Agency, Lilongwe, Malawi
`.trim();
    try {
        await (0, mailer_js_1.sendMail)({ to, subject: subjectMap[purpose], text: body });
        logger_js_1.logger.info(`Email delivered to ${to}`, { purpose });
    }
    catch (error) {
        logger_js_1.logger.error(`SMTP delivery failed for ${to} (${purpose}) — code logged above`, error);
    }
}
