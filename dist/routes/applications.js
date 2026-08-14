"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applicationsRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const audit_js_1 = require("../services/audit.js");
const fileStorage_js_1 = require("../services/fileStorage.js");
const applicationEmails_js_1 = require("../services/applicationEmails.js");
const applications_js_1 = require("../services/applications.js");
const paymentLedger_js_1 = require("../services/paymentLedger.js");
const quoteLineItems_js_1 = require("../services/quoteLineItems.js");
exports.applicationsRouter = (0, express_1.Router)();
exports.applicationsRouter.use(auth_js_1.authenticate);
const passengerSchema = zod_1.z.object({
    passengerType: zod_1.z.enum(["adult", "child", "infant"]),
    firstName: zod_1.z.string().min(1).max(100),
    lastName: zod_1.z.string().min(1).max(100),
    dateOfBirth: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ageYears: zod_1.z.number().int().min(0).max(17).optional(),
    isAccompanied: zod_1.z.boolean().optional(),
    infantSeatBooked: zod_1.z.boolean().optional(),
});
const createSchema = zod_1.z.object({
    originCode: zod_1.z.string().length(3),
    originCity: zod_1.z.string().min(1).max(100),
    destinationCode: zod_1.z.string().length(3),
    destinationCity: zod_1.z.string().min(1).max(100),
    tripType: zod_1.z.enum(["oneway", "roundtrip"]).default("oneway"),
    departDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    departTimePreferred: zod_1.z.string().min(1).max(20),
    returnDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    returnTimePreferred: zod_1.z.string().max(20).optional(),
    contactPhone: zod_1.z.string().min(5).max(32),
    contactWhatsapp: zod_1.z.string().max(32).optional(),
    cabinClass: zod_1.z.string().default("Economy"),
    needCarRental: zod_1.z.boolean().default(false),
    needHotel: zod_1.z.boolean().default(false),
    hotelRequestDetails: zod_1.z.string().max(2000).optional(),
    carRentalRequestDetails: zod_1.z.string().max(2000).optional(),
    specialWheelchair: zod_1.z.boolean().default(false),
    wheelchairReason: zod_1.z.string().max(500).optional(),
    specialMeals: zod_1.z.boolean().default(false),
    mealsReason: zod_1.z.string().max(500).optional(),
    specialSeat: zod_1.z.boolean().default(false),
    seatPreference: zod_1.z.string().max(120).optional(),
    passengers: zod_1.z.array(passengerSchema).min(1).max(12),
});
exports.applicationsRouter.post("/", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = createSchema.parse(req.body);
    const userId = req.user.id;
    const id = (0, uuid_1.v4)();
    const referenceNumber = (0, applications_js_1.generateReferenceNumber)();
    await pool_js_1.pool.execute(`INSERT INTO flight_applications (
        id, user_id, reference_number, status,
        origin_code, origin_city, destination_code, destination_city,
        trip_type, depart_date, depart_time_preferred, return_date, return_time_preferred,
        contact_phone, contact_whatsapp, cabin_class,
        need_car_rental, need_hotel, hotel_request_details, car_rental_request_details,
        special_wheelchair, wheelchair_reason, special_meals, meals_reason,
        special_seat, seat_preference
      ) VALUES (
        :id, :userId, :referenceNumber, 'pending',
        :originCode, :originCity, :destinationCode, :destinationCity,
        :tripType, :departDate, :departTimePreferred, :returnDate, :returnTimePreferred,
        :contactPhone, :contactWhatsapp, :cabinClass,
        :needCarRental, :needHotel, :hotelRequestDetails, :carRentalRequestDetails,
        :specialWheelchair, :wheelchairReason, :specialMeals, :mealsReason,
        :specialSeat, :seatPreference
      )`, {
        id,
        userId,
        referenceNumber,
        originCode: body.originCode.toUpperCase(),
        originCity: body.originCity,
        destinationCode: body.destinationCode.toUpperCase(),
        destinationCity: body.destinationCity,
        tripType: body.tripType,
        departDate: body.departDate,
        departTimePreferred: body.departTimePreferred,
        returnDate: body.returnDate ?? null,
        returnTimePreferred: body.returnTimePreferred ?? null,
        contactPhone: body.contactPhone,
        contactWhatsapp: body.contactWhatsapp ?? null,
        cabinClass: body.cabinClass,
        needCarRental: body.needCarRental ? 1 : 0,
        needHotel: body.needHotel ? 1 : 0,
        hotelRequestDetails: body.needHotel && body.hotelRequestDetails ? body.hotelRequestDetails : null,
        carRentalRequestDetails: body.needCarRental && body.carRentalRequestDetails ? body.carRentalRequestDetails : null,
        specialWheelchair: body.specialWheelchair ? 1 : 0,
        wheelchairReason: body.wheelchairReason ?? null,
        specialMeals: body.specialMeals ? 1 : 0,
        mealsReason: body.mealsReason ?? null,
        specialSeat: body.specialSeat ? 1 : 0,
        seatPreference: body.seatPreference ?? null,
    });
    for (let i = 0; i < body.passengers.length; i++) {
        const p = body.passengers[i];
        await pool_js_1.pool.execute(`INSERT INTO flight_application_passengers (
          id, application_id, passenger_type, first_name, last_name,
          date_of_birth, age_years, is_accompanied, infant_seat_booked, sort_order
        ) VALUES (
          :id, :applicationId, :passengerType, :firstName, :lastName,
          :dateOfBirth, :ageYears, :isAccompanied, :infantSeatBooked, :sortOrder
        )`, {
            id: (0, uuid_1.v4)(),
            applicationId: id,
            passengerType: p.passengerType,
            firstName: p.firstName,
            lastName: p.lastName,
            dateOfBirth: p.dateOfBirth ?? null,
            ageYears: p.ageYears ?? null,
            isAccompanied: p.isAccompanied != null ? (p.isAccompanied ? 1 : 0) : null,
            infantSeatBooked: p.infantSeatBooked != null ? (p.infantSeatBooked ? 1 : 0) : null,
            sortOrder: i + 1,
        });
    }
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: userId });
    const user = users[0];
    await (0, applications_js_1.recordApplicationEvent)(id, "submitted", "Customer submitted flight availability request.");
    const [appRow] = await pool_js_1.pool.execute(`SELECT * FROM flight_applications WHERE id = :id`, {
        id,
    });
    await (0, applicationEmails_js_1.emailApplicationSubmitted)((0, applications_js_1.emailContextFromRow)(appRow[0], `${user.first_name} ${user.last_name}`, user.email));
    await (0, audit_js_1.writeAuditLog)({
        userId,
        action: "application.submitted",
        metadata: { applicationId: id, referenceNumber },
        ipAddress: req.ip ?? null,
    });
    const loaded = await (0, applications_js_1.loadApplication)(id);
    res.status(201).json(loaded);
}));
exports.applicationsRouter.get("/", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM flight_applications WHERE user_id = :userId ORDER BY created_at DESC`, { userId: req.user.id });
    const applications = await Promise.all(rows.map(async (row) => {
        const [passengers] = await pool_js_1.pool.execute(`SELECT * FROM flight_application_passengers WHERE application_id = :id ORDER BY sort_order`, { id: row.id });
        return (0, applications_js_1.mapApplication)(row, passengers);
    }));
    res.json({ applications });
}));
exports.applicationsRouter.get("/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded || loaded.raw.user_id !== req.user.id) {
        throw new errorHandler_js_1.AppError(404, "Application not found");
    }
    res.json(loaded);
}));
exports.applicationsRouter.get("/:id/tickets/:ticketId", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const applicationId = zod_1.z.string().uuid().parse(req.params.id);
    const ticketId = zod_1.z.string().uuid().parse(req.params.ticketId);
    const [apps] = await pool_js_1.pool.execute(`SELECT user_id FROM flight_applications WHERE id = :id`, { id: applicationId });
    if (!apps[0] || apps[0].user_id !== req.user.id)
        throw new errorHandler_js_1.AppError(404, "Not found");
    const [tickets] = await pool_js_1.pool.execute(`SELECT file_name, mime_type, file_path, file_data FROM flight_application_tickets WHERE id = :id AND application_id = :applicationId`, { id: ticketId, applicationId });
    const ticket = tickets[0];
    if (!ticket)
        throw new errorHandler_js_1.AppError(404, "Ticket not found");
    const content = await (0, fileStorage_js_1.loadTicketFileContent)(ticket);
    res.setHeader("Content-Type", ticket.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${ticket.file_name}"`);
    res.send(content);
}));
exports.applicationsRouter.post("/:id/pay-demo", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded || loaded.raw.user_id !== req.user.id)
        throw new errorHandler_js_1.AppError(404, "Application not found");
    if (loaded.application.status !== "awaiting_payment") {
        throw new errorHandler_js_1.AppError(409, "Application is not awaiting payment");
    }
    await pool_js_1.pool.execute(`UPDATE flight_applications SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE id = :id`, { id });
    await (0, applications_js_1.recordApplicationEvent)(id, "payment_demo", "Customer completed demo payment.");
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: req.user.id });
    const user = users[0];
    const ctx = (0, applications_js_1.emailContextFromRow)(loaded.raw, `${user.first_name} ${user.last_name}`, user.email);
    await (0, applicationEmails_js_1.emailApplicationPaidAdmin)({ ...ctx, totalMwk: loaded.application.totalPriceMwk });
    res.json({ message: "Demo payment recorded", status: "paid" });
}));
exports.applicationsRouter.patch("/:id/quote-items", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const body = zod_1.z.object({ itemId: zod_1.z.string().min(1) }).parse(req.body);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded || loaded.raw.user_id !== req.user.id) {
        throw new errorHandler_js_1.AppError(404, "Application not found");
    }
    if (loaded.application.status !== "awaiting_payment") {
        throw new errorHandler_js_1.AppError(409, "Quote can only be adjusted while awaiting payment");
    }
    const items = (0, quoteLineItems_js_1.parseQuoteLineItems)(loaded.raw.quote_line_items);
    if (items.length === 0) {
        throw new errorHandler_js_1.AppError(400, "This quote does not support item removal");
    }
    const target = items.find((i) => i.id === body.itemId);
    if (!target)
        throw new errorHandler_js_1.AppError(404, "Quote item not found");
    if (!target.removable)
        throw new errorHandler_js_1.AppError(400, "This charge cannot be removed");
    if (target.removed)
        throw new errorHandler_js_1.AppError(409, "This charge was already removed");
    const updatedItems = (0, quoteLineItems_js_1.removeQuoteLineItem)(items, body.itemId);
    const totals = (0, quoteLineItems_js_1.quoteTotals)(updatedItems);
    await pool_js_1.pool.execute(`UPDATE flight_applications SET
        extra_charges_mwk = :extraChargesMwk,
        quote_line_items = :quoteLineItems
       WHERE id = :id`, {
        id,
        extraChargesMwk: totals.extrasMwk,
        quoteLineItems: JSON.stringify(updatedItems),
    });
    await (0, paymentLedger_js_1.expirePendingLedgersForOrder)("flight_application", id);
    await (0, applications_js_1.recordApplicationEvent)(id, "quote_item_removed", `Customer removed optional charge: ${target.label}.`);
    const refreshed = await (0, applications_js_1.loadApplication)(id);
    res.json({ application: refreshed.application });
}));
exports.applicationsRouter.post("/:id/cancel", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded || loaded.raw.user_id !== req.user.id)
        throw new errorHandler_js_1.AppError(404, "Application not found");
    if (!["pending", "in_review", "awaiting_payment"].includes(loaded.application.status)) {
        throw new errorHandler_js_1.AppError(409, "Application cannot be cancelled at this stage");
    }
    await pool_js_1.pool.execute(`UPDATE flight_applications SET status = 'cancelled' WHERE id = :id`, { id });
    await (0, applications_js_1.recordApplicationEvent)(id, "cancelled", "Customer cancelled the application.");
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: req.user.id });
    const user = users[0];
    await (0, applicationEmails_js_1.emailApplicationCancelled)((0, applications_js_1.emailContextFromRow)(loaded.raw, `${user.first_name} ${user.last_name}`, user.email));
    res.json({ message: "Application cancelled" });
}));
