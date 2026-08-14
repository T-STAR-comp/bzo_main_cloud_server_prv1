"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const audit_js_1 = require("../services/audit.js");
const travelCredits_js_1 = require("../services/travelCredits.js");
const ticketUtils_js_1 = require("../services/ticketUtils.js");
exports.accountRouter = (0, express_1.Router)();
exports.accountRouter.use(auth_js_1.authenticate);
exports.accountRouter.get("/me", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const userId = req.user.id;
    const [users] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, { id: userId });
    const user = users[0];
    if (!user)
        throw new errorHandler_js_1.AppError(404, "User not found");
    const [prefs] = await pool_js_1.pool.execute(`SELECT * FROM user_preferences WHERE user_id = :userId`, { userId });
    const [credit] = await pool_js_1.pool.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`, { userId });
    const [bookings] = await pool_js_1.pool.execute(`SELECT * FROM bookings WHERE user_id = :userId ORDER BY depart_at DESC`, { userId });
    const [tickets] = await pool_js_1.pool.execute(`SELECT t.*, b.pnr,
        fa.id AS application_id,
        fat.id AS app_ticket_id
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN flight_application_tickets fat ON fat.ticket_record_id = t.id
       LEFT JOIN flight_applications fa ON fa.booking_id = t.booking_id
       WHERE t.user_id = :userId ORDER BY t.depart_at DESC`, { userId });
    res.json({
        user: (0, audit_js_1.publicUser)(user),
        preferences: mapPreferences(prefs[0]),
        travelCreditMwk: credit[0]?.balance_mwk ?? 0,
        bookings: bookings.map(mapBooking),
        tickets: tickets.map(mapTicket),
    });
}));
const profileSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(1).max(100).optional(),
    lastName: zod_1.z.string().min(1).max(100).optional(),
    phone: zod_1.z.string().max(32).nullable().optional(),
    dateOfBirth: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    nationality: zod_1.z.string().max(100).nullable().optional(),
});
exports.accountRouter.patch("/profile", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = profileSchema.parse(req.body);
    const userId = req.user.id;
    const fields = [];
    const params = { userId };
    if (body.firstName !== undefined) {
        fields.push("first_name = :firstName");
        params.firstName = body.firstName;
    }
    if (body.lastName !== undefined) {
        fields.push("last_name = :lastName");
        params.lastName = body.lastName;
    }
    if (body.phone !== undefined) {
        fields.push("phone = :phone");
        params.phone = body.phone;
    }
    if (body.dateOfBirth !== undefined) {
        fields.push("date_of_birth = :dateOfBirth");
        params.dateOfBirth = body.dateOfBirth;
    }
    if (body.nationality !== undefined) {
        fields.push("nationality = :nationality");
        params.nationality = body.nationality;
    }
    if (fields.length === 0)
        throw new errorHandler_js_1.AppError(400, "No fields to update");
    await pool_js_1.pool.execute(`UPDATE users SET ${fields.join(", ")} WHERE id = :userId`, params);
    const [users] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, { id: userId });
    await (0, audit_js_1.writeAuditLog)({
        userId,
        action: "account.profile_updated",
        metadata: body,
        ipAddress: req.ip ?? null,
    });
    res.json({ user: (0, audit_js_1.publicUser)(users[0]) });
}));
const preferencesSchema = zod_1.z.object({
    cabinClass: zod_1.z.string().max(50).optional(),
    seatPreference: zod_1.z.string().max(50).optional(),
    meal: zod_1.z.string().max(50).optional(),
    frequentFlyer: zod_1.z.string().max(120).nullable().optional(),
    directFlightsOnly: zod_1.z.boolean().optional(),
    avoidRedEyes: zod_1.z.boolean().optional(),
    offsetCarbon: zod_1.z.boolean().optional(),
    accountCurrency: zod_1.z.string().length(3).nullable().optional(),
    language: zod_1.z.string().max(20).optional(),
    timezone: zod_1.z.string().max(64).optional(),
    notifyFlightStatus: zod_1.z.boolean().optional(),
    notifyGateDelay: zod_1.z.boolean().optional(),
    notifyFareDrops: zod_1.z.boolean().optional(),
    notifyJournal: zod_1.z.boolean().optional(),
    notifyProductNews: zod_1.z.boolean().optional(),
});
exports.accountRouter.patch("/preferences", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = preferencesSchema.parse(req.body);
    const userId = req.user.id;
    const map = {
        cabinClass: "cabin_class",
        seatPreference: "seat_preference",
        meal: "meal",
        frequentFlyer: "frequent_flyer",
        directFlightsOnly: "direct_flights_only",
        avoidRedEyes: "avoid_red_eyes",
        offsetCarbon: "offset_carbon",
        accountCurrency: "account_currency",
        language: "language",
        timezone: "timezone",
        notifyFlightStatus: "notify_flight_status",
        notifyGateDelay: "notify_gate_delay",
        notifyFareDrops: "notify_fare_drops",
        notifyJournal: "notify_journal",
        notifyProductNews: "notify_product_news",
    };
    const fields = [];
    const params = { userId };
    for (const [key, column] of Object.entries(map)) {
        const val = body[key];
        if (val !== undefined) {
            fields.push(`${column} = :${key}`);
            params[key] = typeof val === "boolean" ? (val ? 1 : 0) : val;
        }
    }
    if (fields.length === 0)
        throw new errorHandler_js_1.AppError(400, "No preferences to update");
    await pool_js_1.pool.execute(`UPDATE user_preferences SET ${fields.join(", ")} WHERE user_id = :userId`, params);
    const [prefs] = await pool_js_1.pool.execute(`SELECT * FROM user_preferences WHERE user_id = :userId`, { userId });
    await (0, audit_js_1.writeAuditLog)({
        userId,
        action: "account.preferences_updated",
        ipAddress: req.ip ?? null,
    });
    res.json({ preferences: mapPreferences(prefs[0]) });
}));
exports.accountRouter.get("/travel-credits/recipients", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const q = zod_1.z.string().min(3).max(120).parse(req.query.q);
    const recipients = await (0, travelCredits_js_1.searchTravelCreditRecipients)(req.user.id, q);
    res.json({ recipients });
}));
const shareTravelCreditSchema = zod_1.z.object({
    recipientUserId: zod_1.z.string().uuid(),
    amountMwk: zod_1.z.number().positive(),
    note: zod_1.z.string().max(200).optional(),
});
exports.accountRouter.post("/travel-credits/share", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = shareTravelCreditSchema.parse(req.body);
    const result = await (0, travelCredits_js_1.shareTravelCredit)({
        fromUserId: req.user.id,
        toUserId: body.recipientUserId,
        amountMwk: body.amountMwk,
        note: body.note,
    });
    res.json({
        message: `Shared MWK ${body.amountMwk.toLocaleString()} with ${result.recipient.firstName} ${result.recipient.lastName}`,
        balanceMwk: result.balanceMwk,
        transferRef: result.transferRef,
        recipient: result.recipient,
    });
}));
function mapPreferences(row) {
    if (!row)
        return null;
    return {
        cabinClass: row.cabin_class,
        seatPreference: row.seat_preference,
        meal: row.meal,
        frequentFlyer: row.frequent_flyer,
        directFlightsOnly: Boolean(row.direct_flights_only),
        avoidRedEyes: Boolean(row.avoid_red_eyes),
        offsetCarbon: Boolean(row.offset_carbon),
        accountCurrency: row.account_currency,
        language: row.language,
        timezone: row.timezone,
        notifyFlightStatus: Boolean(row.notify_flight_status),
        notifyGateDelay: Boolean(row.notify_gate_delay),
        notifyFareDrops: Boolean(row.notify_fare_drops),
        notifyJournal: Boolean(row.notify_journal),
        notifyProductNews: Boolean(row.notify_product_news),
    };
}
function mapBooking(row) {
    return {
        id: row.id,
        pnr: row.pnr,
        status: row.status,
        originCode: row.origin_code,
        originCity: row.origin_city,
        destinationCode: row.destination_code,
        destinationCity: row.destination_city,
        airline: row.airline,
        flightNumber: row.flight_number,
        departAt: new Date(row.depart_at).toISOString(),
        arriveAt: new Date(row.arrive_at).toISOString(),
        cabinClass: row.cabin_class,
        priceMwk: Number(row.price_mwk),
    };
}
function mapTicket(row) {
    const applicationId = row.application_id;
    const appTicketId = row.app_ticket_id;
    const departAt = new Date(row.depart_at).toISOString();
    const dbStatus = row.status;
    const displayStatus = (0, ticketUtils_js_1.ticketDisplayStatus)(departAt, dbStatus);
    return {
        id: row.id,
        bookingId: row.booking_id,
        pnr: row.pnr,
        originCode: row.origin_code,
        destinationCode: row.destination_code,
        originCity: row.origin_city,
        destinationCity: row.destination_city,
        departAt,
        arriveAt: new Date(row.arrive_at).toISOString(),
        airline: row.airline,
        flightLabel: row.flight_label,
        seat: row.seat,
        gate: row.gate,
        class: row.class,
        status: dbStatus,
        displayStatus,
        isInactive: displayStatus === "inactive",
        passengerNames: row.passenger_names ?? null,
        applicationId,
        documentUrl: applicationId && appTicketId
            ? `/applications/${applicationId}/tickets/${appTicketId}`
            : null,
    };
}
