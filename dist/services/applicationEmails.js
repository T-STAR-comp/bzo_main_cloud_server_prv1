"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailApplicationSubmitted = emailApplicationSubmitted;
exports.emailApplicationInReview = emailApplicationInReview;
exports.emailApplicationQuoted = emailApplicationQuoted;
exports.emailApplicationPaidAdmin = emailApplicationPaidAdmin;
exports.emailManualPaymentProofSubmittedAdmin = emailManualPaymentProofSubmittedAdmin;
exports.emailPurchasingTickets = emailPurchasingTickets;
exports.emailApplicationPurchasingTickets = emailApplicationPurchasingTickets;
exports.emailApplicationCompleted = emailApplicationCompleted;
exports.emailDepartureWeekBeforeReminder = emailDepartureWeekBeforeReminder;
exports.emailDepartureDayBeforeReminder = emailDepartureDayBeforeReminder;
exports.emailApplicationCancelled = emailApplicationCancelled;
const platformSettings_js_1 = require("./platformSettings.js");
const mailer_js_1 = require("./mailer.js");
const config_js_1 = require("../config.js");
const destinationFunFacts_js_1 = require("./destinationFunFacts.js");
const emailHtmlTemplate_js_1 = require("./emailHtmlTemplate.js");
function formatDepart(iso) {
    return new Date(iso).toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
function clientAppOrigin() {
    return config_js_1.config.clientOrigins[0] ?? "http://localhost:3000";
}
function dashboardPaymentUrl(applicationId) {
    return `${clientAppOrigin()}/dashboard/applications?applicationId=${applicationId}`;
}
function dashboardApplicationsUrl() {
    return `${clientAppOrigin()}/dashboard/applications`;
}
async function sendCustomerEmail(input) {
    await (0, mailer_js_1.sendMail)({
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments,
    });
}
async function sendAdminEmail(input) {
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        title: input.title,
        bodyText: input.bodyText,
        preheader: input.subject,
    });
    await (0, mailer_js_1.sendMail)({
        to: config_js_1.config.admin.email,
        subject: input.subject,
        text: input.text,
        html,
        attachments: input.attachments,
    });
}
async function emailApplicationSubmitted(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const text = `Hi ${ctx.customerName},

We've received your flight availability request (${ctx.referenceNumber}) for ${ctx.origin} → ${ctx.destination} on ${ctx.departDate}.

Our team is reviewing options with partner airlines. You'll hear from us soon - most requests receive a quote within a few hours.

Hang tight - we're on it.${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `We received your request ${ctx.referenceNumber}`,
        title: "Request received",
        greeting: `Hi ${ctx.customerName},`,
        bodyText: `We've received your flight request and our team is already checking availability with partner airlines.

Most quotes arrive within a few hours. We'll email you as soon as your price is ready.`,
        highlightHtml: `<strong>Reference:</strong> ${(0, emailHtmlTemplate_js_1.escapeHtml)(ctx.referenceNumber)}<br/><strong>Route:</strong> ${(0, emailHtmlTemplate_js_1.escapeHtml)(ctx.origin)} → ${(0, emailHtmlTemplate_js_1.escapeHtml)(ctx.destination)}<br/><strong>Travel date:</strong> ${(0, emailHtmlTemplate_js_1.escapeHtml)(ctx.departDate)}`,
        button: { label: "Track my request", href: dashboardApplicationsUrl() },
    });
    await sendCustomerEmail({ to: ctx.customerEmail, subject: `Application received · ${ctx.referenceNumber}`, text, html });
    await sendAdminEmail({
        subject: `[New application] ${ctx.referenceNumber} · ${ctx.origin} → ${ctx.destination}`,
        title: "New flight request",
        bodyText: `${ctx.customerName} (${ctx.customerEmail}) submitted a new availability request.`,
        text: `New flight application from ${ctx.customerName} (${ctx.customerEmail}).\n\nRef: ${ctx.referenceNumber}\nRoute: ${ctx.origin} → ${ctx.destination}\nDepart: ${ctx.departDate}\n\nReview in the Biazo admin console.`,
    });
}
async function emailApplicationInReview(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const text = `Hi ${ctx.customerName},

Good news - a Biazo concierge has opened your application (${ctx.referenceNumber}) and is checking availability now.

We'll update you as soon as we have options. Thanks for your patience.${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `We're working on ${ctx.referenceNumber}`,
        title: "We're checking flights for you",
        greeting: `Hi ${ctx.customerName},`,
        bodyText: `Good news — a Biazo concierge has opened your request (${ctx.referenceNumber}) and is checking availability now.

We'll update you as soon as we have options. Thanks for your patience.`,
        button: { label: "View my request", href: dashboardApplicationsUrl() },
    });
    await sendCustomerEmail({
        to: ctx.customerEmail,
        subject: `We're working on ${ctx.referenceNumber}`,
        text,
        html,
    });
}
async function emailApplicationQuoted(input) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const { ctx, applicationId, priceMwk, extraChargesMwk, isAlternate, adminMessage, quotedSummary } = input;
    const total = input.totalMwk ?? priceMwk + extraChargesMwk;
    const payUrl = dashboardPaymentUrl(applicationId);
    const intro = isAlternate
        ? `We've found availability close to your request, with a few adjustments:`
        : `Great news - we found a match for your request:`;
    const breakdown = input.lineItemsSummary
        ? `\n\nPrice breakdown:\n${input.lineItemsSummary}`
        : `\n\nFare: MWK ${priceMwk.toLocaleString()}${extraChargesMwk > 0 ? `\nExtra charges: MWK ${extraChargesMwk.toLocaleString()}${input.extraNote ? ` (${input.extraNote})` : ""}` : ""}`;
    const text = `Hi ${ctx.customerName},

${intro}

${quotedSummary}
${breakdown}
Total: MWK ${total.toLocaleString()}

Optional add-ons (hotel, car rental, etc.) can be removed before you pay in your dashboard.

Pay or review your quote:
${payUrl}

${adminMessage ? `${adminMessage}\n\n` : ""}Sign in to your Biazo dashboard to complete payment or cancel this quote.${footer}`;
    const highlightParts = [
        (0, emailHtmlTemplate_js_1.escapeHtml)(quotedSummary).replace(/\n/g, "<br/>"),
        `<strong>Total:</strong> MWK ${total.toLocaleString()}`,
    ];
    if (input.lineItemsSummary) {
        highlightParts.push((0, emailHtmlTemplate_js_1.escapeHtml)(input.lineItemsSummary).replace(/\n/g, "<br/>"));
    }
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `Your quote for ${ctx.referenceNumber} is ready`,
        title: isAlternate ? "An alternate option is available" : "Your price is ready",
        greeting: `Hi ${ctx.customerName},`,
        bodyText: isAlternate
            ? "We found a flight close to what you asked for, with a few small changes. Review the details below, then sign in to pay or remove optional extras."
            : "Great news — we found availability for your trip. Review your quote below, then sign in to pay when you're ready.",
        highlightHtml: highlightParts.join("<br/><br/>"),
        bullets: adminMessage ? [adminMessage] : undefined,
        button: { label: "Review & pay now", href: payUrl },
    });
    await sendCustomerEmail({
        to: ctx.customerEmail,
        subject: isAlternate ? `Alternate option available · ${ctx.referenceNumber}` : `Your quote is ready · ${ctx.referenceNumber}`,
        text,
        html,
    });
}
async function emailApplicationPaidAdmin(ctx) {
    await sendAdminEmail({
        subject: `[Payment received] ${ctx.referenceNumber}`,
        title: "Payment received",
        bodyText: `${ctx.customerName} paid for ${ctx.referenceNumber}. Total: MWK ${ctx.totalMwk.toLocaleString()}. Purchase tickets and upload them in the admin console.`,
        text: `Payment received for ${ctx.referenceNumber} (${ctx.customerName}).\nTotal: MWK ${ctx.totalMwk.toLocaleString()}\n\nPurchase tickets and upload them in the admin console.`,
    });
}
async function emailManualPaymentProofSubmittedAdmin(ctx) {
    await sendAdminEmail({
        subject: `[Proof of payment] ${ctx.referenceNumber} · ${ctx.manualReference}`,
        title: "Proof of payment submitted",
        bodyText: `${ctx.customerName} submitted proof of payment for ${ctx.referenceNumber}. Amount: MWK ${ctx.totalMwk.toLocaleString()}. Reference to verify: ${ctx.manualReference}. Review the receipt in the admin console.`,
        text: `${ctx.customerName} submitted proof of payment for ${ctx.referenceNumber}.\n\nAmount: MWK ${ctx.totalMwk.toLocaleString()}\nReference to verify: ${ctx.manualReference}\n\nReview the receipt in the Biazo admin console (Payments) and approve or reject.`,
    });
}
async function emailPurchasingTickets(ctx) {
    return emailApplicationPurchasingTickets(ctx);
}
async function emailApplicationPurchasingTickets(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const text = `Hi ${ctx.customerName},

We've received your payment for ${ctx.referenceNumber} and our team is purchasing your ticket(s) with the airline now.

You'll receive your e-tickets shortly.${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `We're buying your tickets for ${ctx.referenceNumber}`,
        title: "Payment confirmed — buying your tickets",
        greeting: `Hi ${ctx.customerName},`,
        bodyText: `We've received your payment for ${ctx.referenceNumber}. Our team is purchasing your ticket(s) with the airline now.

You'll receive your e-tickets by email and in your dashboard shortly.`,
        button: { label: "View my request", href: dashboardApplicationsUrl() },
    });
    await sendCustomerEmail({
        to: ctx.customerEmail,
        subject: `Purchasing your tickets · ${ctx.referenceNumber}`,
        text,
        html,
    });
}
async function emailApplicationCompleted(input) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    let funFactBlock = "";
    let funFactBullet;
    if (input.ctx.userId && input.ctx.destinationCode && input.ctx.destinationCity) {
        const fun = await (0, destinationFunFacts_js_1.pickFunFactForUser)({
            userId: input.ctx.userId,
            destinationCode: input.ctx.destinationCode,
            destinationCity: input.ctx.destinationCity,
            context: "ticket_delivery",
        });
        funFactBlock = `\n\n✈️ Did you know?\n${fun.label}: ${fun.fact}\n\nWe hope this little spark of curiosity makes your journey even more exciting.`;
        funFactBullet = `${fun.label}: ${fun.fact}`;
    }
    const text = `Hi ${input.ctx.customerName},

Your tickets for ${input.ctx.referenceNumber} are ready. They're attached to this email and available in your Biazo dashboard.

${input.auditSummary}${funFactBlock}${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `Your tickets for ${input.ctx.referenceNumber} are ready`,
        title: "Your tickets are ready",
        greeting: `Hi ${input.ctx.customerName},`,
        bodyText: `Your tickets for ${input.ctx.referenceNumber} are attached to this email and saved in your Biazo dashboard.`,
        highlightHtml: (0, emailHtmlTemplate_js_1.escapeHtml)(input.auditSummary).replace(/\n/g, "<br/>"),
        bullets: funFactBullet ? [`Did you know? ${funFactBullet}`] : undefined,
        button: { label: "Open my tickets", href: `${clientAppOrigin()}/dashboard/tickets` },
    });
    const attachments = input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
    }));
    await sendCustomerEmail({
        to: input.ctx.customerEmail,
        subject: `Tickets ready · ${input.ctx.referenceNumber}`,
        text,
        html,
        attachments,
    });
    await sendAdminEmail({
        subject: `[Completed] ${input.ctx.referenceNumber}`,
        title: "Application completed",
        bodyText: `Application ${input.ctx.referenceNumber} marked complete.\n\n${input.auditSummary}`,
        text: `Application ${input.ctx.referenceNumber} marked complete.\n\n${input.auditSummary}`,
        attachments,
    });
}
async function emailDepartureWeekBeforeReminder(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const ref = ctx.referenceNumber ? ` (${ctx.referenceNumber})` : "";
    const bullets = [
        `${ctx.originCity} → ${ctx.destinationCity}`,
        formatDepart(ctx.departAt),
        `${ctx.airline}${ctx.flightLabel ? ` ${ctx.flightLabel}` : ""}`,
        `PNR: ${ctx.pnr}${ref}${ctx.seat ? ` · Seat: ${ctx.seat}` : ""}`,
        "Check your passport validity (many countries want 6 months remaining).",
        `Confirm visa or entry requirements for ${ctx.destinationLabel ?? ctx.destinationCity}.`,
        "Online check-in usually opens 24–48 hours before departure.",
        "Share your itinerary with someone you trust back home.",
    ];
    const text = `Hi ${ctx.customerName},

Your adventure is almost here - just one week to go until you fly to ${ctx.destinationCity}!

Flight details
• ${bullets.slice(0, 4).join("\n• ")}

A few gentle reminders before you go:
• ${bullets.slice(4).join("\n• ")}${ctx.funFact ? `\n\nA little something about ${ctx.destinationLabel ?? ctx.destinationCity}:\n${ctx.funFact}` : ""}

We're cheering you on from Lilongwe. Travel safely and travel happy.${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `One week until ${ctx.destinationCity}`,
        title: `One week until ${ctx.destinationCity}`,
        greeting: `Hi ${ctx.customerName},`,
        bodyText: "Your adventure is almost here — just one week to go! Here are your flight details and a few gentle reminders before you travel.",
        bullets: ctx.funFact ? [...bullets, `About ${ctx.destinationLabel ?? ctx.destinationCity}: ${ctx.funFact}`] : bullets,
        button: { label: "View my trip", href: `${clientAppOrigin()}/dashboard/tickets` },
    });
    await sendCustomerEmail({
        to: ctx.customerEmail,
        subject: `One week until your trip to ${ctx.destinationCity} ✈️`,
        text,
        html,
    });
}
async function emailDepartureDayBeforeReminder(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const ref = ctx.referenceNumber ? ` (${ctx.referenceNumber})` : "";
    const bullets = [
        "Pack essentials in your carry-on: documents, medications, charger, one change of clothes.",
        "Charge your phone and download your e-ticket from the Biazo dashboard.",
        `${ctx.gate ? `Gate ${ctx.gate} — ` : ""}Arrive at the airport at least 2–3 hours before international departures.`,
        `${ctx.seat ? `Your seat: ${ctx.seat}. ` : ""}PNR: ${ctx.pnr}${ref}`,
    ];
    const text = `Hi ${ctx.customerName},

Tomorrow is the day - your flight to ${ctx.destinationCity} departs ${formatDepart(ctx.departAt)}.

Quick checklist:
• ${bullets.join("\n• ")}

${ctx.funFact ? `Packing tip with a smile - about ${ctx.destinationLabel ?? ctx.destinationCity}:\n${ctx.funFact}\n\n` : ""}You've got this. Zip up that bag, get some rest, and we'll see you in the skies tomorrow.

Bon voyage from all of us at Biazo.${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `Tomorrow you fly to ${ctx.destinationCity}`,
        title: "Tomorrow you fly — time to pack",
        greeting: `Hi ${ctx.customerName},`,
        bodyText: `Tomorrow is the day! Your flight to ${ctx.destinationCity} departs ${formatDepart(ctx.departAt)}.`,
        bullets: ctx.funFact ? [...bullets, `About ${ctx.destinationLabel ?? ctx.destinationCity}: ${ctx.funFact}`] : bullets,
        button: { label: "Open my ticket", href: `${clientAppOrigin()}/dashboard/tickets` },
    });
    await sendCustomerEmail({
        to: ctx.customerEmail,
        subject: `Tomorrow you fly - time to start packing 🧳`,
        text,
        html,
    });
}
async function emailApplicationCancelled(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const text = `Hi ${ctx.customerName},

Your application ${ctx.referenceNumber} has been cancelled. You can submit a new request anytime from your dashboard.${footer}`;
    const { html } = await (0, emailHtmlTemplate_js_1.renderEmailWithFooter)({
        preheader: `Request ${ctx.referenceNumber} cancelled`,
        title: "Request cancelled",
        greeting: `Hi ${ctx.customerName},`,
        bodyText: `Your request ${ctx.referenceNumber} has been cancelled. You can submit a new flight request anytime from your dashboard.`,
        button: { label: "Request a new flight", href: `${clientAppOrigin()}/dashboard/book` },
    });
    await sendCustomerEmail({
        to: ctx.customerEmail,
        subject: `Application cancelled · ${ctx.referenceNumber}`,
        text,
        html,
    });
}
