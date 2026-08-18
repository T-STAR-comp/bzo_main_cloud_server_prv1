import { getEmailFooterLine } from "./platformSettings.js";
import { sendMail } from "./mailer.js";
import { config } from "../config.js";
import { pickFunFactForUser } from "./destinationFunFacts.js";

type ApplicationEmailContext = {
  referenceNumber: string;
  customerName: string;
  customerEmail: string;
  origin: string;
  destination: string;
  departDate: string;
  userId?: string;
  destinationCity?: string;
  destinationCode?: string;
};

type TripEmailContext = {
  customerName: string;
  customerEmail: string;
  pnr: string;
  referenceNumber: string | null;
  originCity: string;
  destinationCity: string;
  destinationCode: string;
  departAt: string;
  airline: string;
  flightLabel: string | null;
  seat: string | null;
  gate?: string | null;
  funFact?: string;
  destinationLabel?: string;
};

function formatDepart(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function emailApplicationSubmitted(ctx: ApplicationEmailContext) {
  const footer = await getEmailFooterLine();
  const body = `Hi ${ctx.customerName},

We've received your flight availability request (${ctx.referenceNumber}) for ${ctx.origin} → ${ctx.destination} on ${ctx.departDate}.

Our team is reviewing options with partner airlines. You'll hear from us soon — most requests receive a quote within a few hours.

Hang tight — we're on it.${footer}`;

  await sendMail({
    to: ctx.customerEmail,
    subject: `Application received · ${ctx.referenceNumber}`,
    text: body,
  });

  await sendMail({
    to: config.admin.email,
    subject: `[New application] ${ctx.referenceNumber} · ${ctx.origin} → ${ctx.destination}`,
    text: `New flight application from ${ctx.customerName} (${ctx.customerEmail}).\n\nRef: ${ctx.referenceNumber}\nRoute: ${ctx.origin} → ${ctx.destination}\nDepart: ${ctx.departDate}\n\nReview in the Biazo admin console.`,
  });
}

export async function emailApplicationInReview(ctx: ApplicationEmailContext) {
  const footer = await getEmailFooterLine();
  await sendMail({
    to: ctx.customerEmail,
    subject: `We're working on ${ctx.referenceNumber}`,
    text: `Hi ${ctx.customerName},

Good news — a Biazo concierge has opened your application (${ctx.referenceNumber}) and is checking availability now.

We'll update you as soon as we have options. Thanks for your patience.${footer}`,
  });
}

export async function emailApplicationQuoted(input: {
  ctx: ApplicationEmailContext;
  priceMwk: number;
  extraChargesMwk: number;
  extraNote: string | null;
  isAlternate: boolean;
  adminMessage: string | null;
  quotedSummary: string;
  lineItemsSummary?: string;
  totalMwk?: number;
}) {
  const footer = await getEmailFooterLine();
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

  await sendMail({
    to: ctx.customerEmail,
    subject: isAlternate
      ? `Alternate option available · ${ctx.referenceNumber}`
      : `Your quote is ready · ${ctx.referenceNumber}`,
    text: body,
  });
}

export async function emailApplicationPaidAdmin(ctx: ApplicationEmailContext & { totalMwk: number }) {
  await sendMail({
    to: config.admin.email,
    subject: `[Payment received] ${ctx.referenceNumber}`,
    text: `Payment received for ${ctx.referenceNumber} (${ctx.customerName}).\nTotal: MWK ${ctx.totalMwk.toLocaleString()}\n\nPurchase tickets and upload them in the admin console.`,
  });
}

export async function emailManualPaymentProofSubmittedAdmin(
  ctx: ApplicationEmailContext & { totalMwk: number; manualReference: string; ledgerId: string },
) {
  await sendMail({
    to: config.admin.email,
    subject: `[Proof of payment] ${ctx.referenceNumber} · ${ctx.manualReference}`,
    text: `${ctx.customerName} submitted proof of payment for ${ctx.referenceNumber}.\n\nAmount: MWK ${ctx.totalMwk.toLocaleString()}\nReference to verify: ${ctx.manualReference}\n\nReview the receipt in the Biazo admin console (Payments) and approve or reject.`,
  });
}

export async function emailPurchasingTickets(ctx: ApplicationEmailContext) {
  return emailApplicationPurchasingTickets(ctx);
}

export async function emailApplicationPurchasingTickets(ctx: ApplicationEmailContext) {
  const footer = await getEmailFooterLine();
  await sendMail({
    to: ctx.customerEmail,
    subject: `Purchasing your tickets · ${ctx.referenceNumber}`,
    text: `Hi ${ctx.customerName},

We've received your payment for ${ctx.referenceNumber} and our team is purchasing your ticket(s) with the airline now.

You'll receive your e-tickets shortly.${footer}`,
  });
}

export async function emailApplicationCompleted(input: {
  ctx: ApplicationEmailContext;
  auditSummary: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}) {
  const footer = await getEmailFooterLine();
  let funFactBlock = "";

  if (input.ctx.userId && input.ctx.destinationCode && input.ctx.destinationCity) {
    const fun = await pickFunFactForUser({
      userId: input.ctx.userId,
      destinationCode: input.ctx.destinationCode,
      destinationCity: input.ctx.destinationCity,
      context: "ticket_delivery",
    });
    funFactBlock = `\n\n✈️ Did you know?\n${fun.label}: ${fun.fact}\n\nWe hope this little spark of curiosity makes your journey even more exciting.`;
  }

  await sendMail({
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

  await sendMail({
    to: config.admin.email,
    subject: `[Completed] ${input.ctx.referenceNumber}`,
    text: `Application ${input.ctx.referenceNumber} marked complete.\n\n${input.auditSummary}`,
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

export async function emailDepartureWeekBeforeReminder(ctx: TripEmailContext) {
  const footer = await getEmailFooterLine();
  const ref = ctx.referenceNumber ? ` (${ctx.referenceNumber})` : "";
  const funLine = ctx.funFact
    ? `\n\nA little something about ${ctx.destinationLabel ?? ctx.destinationCity}:\n${ctx.funFact}`
    : "";

  await sendMail({
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

export async function emailDepartureDayBeforeReminder(ctx: TripEmailContext) {
  const footer = await getEmailFooterLine();
  const ref = ctx.referenceNumber ? ` (${ctx.referenceNumber})` : "";

  await sendMail({
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

export async function emailApplicationCancelled(ctx: ApplicationEmailContext) {
  const footer = await getEmailFooterLine();
  await sendMail({
    to: ctx.customerEmail,
    subject: `Application cancelled · ${ctx.referenceNumber}`,
    text: `Hi ${ctx.customerName},

Your application ${ctx.referenceNumber} has been cancelled. You can submit a new request anytime from your dashboard.${footer}`,
  });
}
