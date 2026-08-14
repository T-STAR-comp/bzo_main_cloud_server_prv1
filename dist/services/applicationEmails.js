"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailApplicationSubmitted = emailApplicationSubmitted;
exports.emailApplicationInReview = emailApplicationInReview;
exports.emailApplicationQuoted = emailApplicationQuoted;
exports.emailApplicationPaidAdmin = emailApplicationPaidAdmin;
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
async function emailApplicationSubmitted(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const body = `Hi ${ctx.customerName},

We've received your flight availability request (${ctx.referenceNumber}) for ${ctx.origin} → ${ctx.destination} on ${ctx.departDate}.

Our team is reviewing options with partner airlines. You'll hear from us soon — most requests receive a quote within a few hours.

Hang tight — we're on it.${footer}`;
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: `Application received · ${ctx.referenceNumber}`,
        text: body,
    });
    await (0, mailer_js_1.sendMail)({
        to: config_js_1.config.admin.email,
        subject: `[New application] ${ctx.referenceNumber} · ${ctx.origin} → ${ctx.destination}`,
        text: `New flight application from ${ctx.customerName} (${ctx.customerEmail}).\n\nRef: ${ctx.referenceNumber}\nRoute: ${ctx.origin} → ${ctx.destination}\nDepart: ${ctx.departDate}\n\nReview in the Biazo admin console.`,
    });
}
async function emailApplicationInReview(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: `We're working on ${ctx.referenceNumber}`,
        text: `Hi ${ctx.customerName},

Good news — a Biazo concierge has opened your application (${ctx.referenceNumber}) and is checking availability now.

We'll update you as soon as we have options. Thanks for your patience.${footer}`,
    });
}
async function emailApplicationQuoted(input) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const { ctx, priceMwk, extraChargesMwk, isAlternate, adminMessage, quotedSummary } = input;
    const total = input.totalMwk ?? priceMwk + extraChargesMwk;
    const intro = isAlternate
        ? `We've found availability close to your request, with a few adjustments:`
        : `Great news — we found a match for your request:`;
    const breakdown = input.lineItemsSummary
        ? `\n\nPrice breakdown:\n${input.lineItemsSummary}`
        : `\n\nFare: MWK ${priceMwk.toLocaleString()}${extraChargesMwk > 0 ? `\nExtra charges: MWK ${extraChargesMwk.toLocaleString()}${input.extraNote ? ` (${input.extraNote})` : ""}` : ""}`;
    const body = `Hi ${ctx.customerName},

${intro}

${quotedSummary}
${breakdown}
Total: MWK ${total.toLocaleString()}

Optional add-ons (hotel, car rental, etc.) can be removed before you pay in your dashboard.

${adminMessage ? `${adminMessage}\n\n` : ""}Sign in to your Biazo dashboard to pay or cancel this quote.${footer}`;
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: isAlternate
            ? `Alternate option available · ${ctx.referenceNumber}`
            : `Your quote is ready · ${ctx.referenceNumber}`,
        text: body,
    });
}
async function emailApplicationPaidAdmin(ctx) {
    await (0, mailer_js_1.sendMail)({
        to: config_js_1.config.admin.email,
        subject: `[Payment received] ${ctx.referenceNumber}`,
        text: `Payment received for ${ctx.referenceNumber} (${ctx.customerName}).\nTotal: MWK ${ctx.totalMwk.toLocaleString()}\n\nPurchase tickets and upload them in the admin console.`,
    });
}
async function emailPurchasingTickets(ctx) {
    return emailApplicationPurchasingTickets(ctx);
}
async function emailApplicationPurchasingTickets(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: `Purchasing your tickets · ${ctx.referenceNumber}`,
        text: `Hi ${ctx.customerName},

We've received your payment for ${ctx.referenceNumber} and our team is purchasing your ticket(s) with the airline now.

You'll receive your e-tickets shortly.${footer}`,
    });
}
async function emailApplicationCompleted(input) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    let funFactBlock = "";
    if (input.ctx.userId && input.ctx.destinationCode && input.ctx.destinationCity) {
        const fun = await (0, destinationFunFacts_js_1.pickFunFactForUser)({
            userId: input.ctx.userId,
            destinationCode: input.ctx.destinationCode,
            destinationCity: input.ctx.destinationCity,
            context: "ticket_delivery",
        });
        funFactBlock = `\n\n✈️ Did you know?\n${fun.label}: ${fun.fact}\n\nWe hope this little spark of curiosity makes your journey even more exciting.`;
    }
    await (0, mailer_js_1.sendMail)({
        to: input.ctx.customerEmail,
        subject: `Tickets ready · ${input.ctx.referenceNumber}`,
        text: `Hi ${input.ctx.customerName},

Your tickets for ${input.ctx.referenceNumber} are ready. They're attached to this email and available in your Biazo dashboard.

${input.auditSummary}${funFactBlock}${footer}`,
        attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
        })),
    });
    await (0, mailer_js_1.sendMail)({
        to: config_js_1.config.admin.email,
        subject: `[Completed] ${input.ctx.referenceNumber}`,
        text: `Application ${input.ctx.referenceNumber} marked complete.\n\n${input.auditSummary}`,
        attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
        })),
    });
}
async function emailDepartureWeekBeforeReminder(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const ref = ctx.referenceNumber ? ` (${ctx.referenceNumber})` : "";
    const funLine = ctx.funFact
        ? `\n\nA little something about ${ctx.destinationLabel ?? ctx.destinationCity}:\n${ctx.funFact}`
        : "";
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: `One week until your trip to ${ctx.destinationCity} ✈️`,
        text: `Hi ${ctx.customerName},

Your adventure is almost here — just one week to go until you fly to ${ctx.destinationCity}!

Flight details
• ${ctx.originCity} → ${ctx.destinationCity}
• ${formatDepart(ctx.departAt)}
• ${ctx.airline}${ctx.flightLabel ? ` ${ctx.flightLabel}` : ""}
• PNR: ${ctx.pnr}${ref}${ctx.seat ? `\n• Seat: ${ctx.seat}` : ""}

A few gentle reminders before you go:
• Check your passport validity (many countries want 6 months remaining).
• Confirm visa or entry requirements for ${ctx.destinationLabel ?? ctx.destinationCity}.
• Online check-in usually opens 24–48 hours before departure — we'll have your ticket in your dashboard.
• Share your itinerary with someone you trust back home.
• Take a moment to breathe — you've earned this trip.${funLine}

We're cheering you on from Lilongwe. Travel safely and travel happy.${footer}`,
    });
}
async function emailDepartureDayBeforeReminder(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    const ref = ctx.referenceNumber ? ` (${ctx.referenceNumber})` : "";
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: `Tomorrow you fly — time to start packing 🧳`,
        text: `Hi ${ctx.customerName},

Tomorrow is the day — your flight to ${ctx.destinationCity} departs ${formatDepart(ctx.departAt)}.

Quick checklist:
• Pack essentials in your carry-on: documents, medications, charger, one change of clothes.
• Charge your phone and download your e-ticket from the Biazo dashboard (just in case).
• ${ctx.gate ? `Gate ${ctx.gate} — ` : ""}Arrive at the airport at least 2–3 hours before international departures.
• ${ctx.seat ? `Your seat: ${ctx.seat}. ` : ""}PNR: ${ctx.pnr}${ref}

${ctx.funFact ? `Packing tip with a smile — about ${ctx.destinationLabel ?? ctx.destinationCity}:\n${ctx.funFact}\n\n` : ""}You've got this. Zip up that bag, get some rest, and we'll see you in the skies tomorrow.

Bon voyage from all of us at Biazo.${footer}`,
    });
}
async function emailApplicationCancelled(ctx) {
    const footer = await (0, platformSettings_js_1.getEmailFooterLine)();
    await (0, mailer_js_1.sendMail)({
        to: ctx.customerEmail,
        subject: `Application cancelled · ${ctx.referenceNumber}`,
        text: `Hi ${ctx.customerName},

Your application ${ctx.referenceNumber} has been cancelled. You can submit a new request anytime from your dashboard.${footer}`,
    });
}
