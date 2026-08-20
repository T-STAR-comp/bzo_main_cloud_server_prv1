"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transporter = void 0;
exports.sendMail = sendMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../logger.js");
const transporter = config_js_1.config.smtp.host && config_js_1.config.smtp.user
    ? nodemailer_1.default.createTransport({
        host: config_js_1.config.smtp.host,
        port: config_js_1.config.smtp.port,
        secure: config_js_1.config.smtp.secure,
        auth: { user: config_js_1.config.smtp.user, pass: config_js_1.config.smtp.pass },
    })
    : null;
exports.transporter = transporter;
async function sendMail(options) {
    logger_js_1.logger.info(`[email] ${options.subject} → ${Array.isArray(options.to) ? options.to.join(", ") : options.to}`);
    logger_js_1.logger.info(`[email-body]\n${options.text}`);
    if (!transporter) {
        logger_js_1.logger.warn("SMTP not configured - email logged above only");
        return;
    }
    try {
        await transporter.sendMail({
            from: config_js_1.config.smtp.from,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments: options.attachments,
        });
    }
    catch (error) {
        logger_js_1.logger.error("SMTP delivery failed", error);
    }
}
