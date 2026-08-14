"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminApplicationsRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const applicationEmails_js_1 = require("../services/applicationEmails.js");
const applications_js_1 = require("../services/applications.js");
const quoteLineItems_js_1 = require("../services/quoteLineItems.js");
const ticketFulfillment_js_1 = require("../services/ticketFulfillment.js");
const fileStorage_js_1 = require("../services/fileStorage.js");
exports.adminApplicationsRouter = (0, express_1.Router)();
exports.adminApplicationsRouter.use(auth_js_1.authenticate, auth_js_1.requireAdmin);
exports.adminApplicationsRouter.get("/", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const [rows] = await pool_js_1.pool.execute(`SELECT fa.*, u.email, u.first_name, u.last_name, u.phone,
        (SELECT COUNT(*) FROM flight_application_passengers p WHERE p.application_id = fa.id) AS passenger_count
       FROM flight_applications fa
       JOIN users u ON u.id = fa.user_id
       ORDER BY fa.created_at DESC LIMIT 200`);
    res.json({
        applications: rows.map((row) => ({
            ...(0, applications_js_1.mapApplication)(row),
            customerEmail: row.email,
            customerName: `${row.first_name} ${row.last_name}`,
            customerPhone: row.phone,
            passengerCount: Number(row.passenger_count),
        })),
    });
}));
exports.adminApplicationsRouter.get("/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    let loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded)
        throw new errorHandler_js_1.AppError(404, "Application not found");
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: loaded.raw.user_id });
    const user = users[0];
    const ctx = (0, applications_js_1.emailContextFromRow)(loaded.raw, `${user.first_name} ${user.last_name}`, user.email);
    if (loaded.application.status === "pending") {
        await pool_js_1.pool.execute(`UPDATE flight_applications SET status = 'in_review', opened_by_admin_at = UTC_TIMESTAMP() WHERE id = :id`, { id });
        await (0, applications_js_1.recordApplicationEvent)(id, "in_review", "Admin opened application — now in review.");
        await (0, applicationEmails_js_1.emailApplicationInReview)(ctx);
        loaded = (await (0, applications_js_1.loadApplication)(id));
    }
    else if (loaded.application.status === "paid") {
        await pool_js_1.pool.execute(`UPDATE flight_applications SET status = 'purchasing' WHERE id = :id`, { id });
        await (0, applications_js_1.recordApplicationEvent)(id, "purchasing", "Admin opened paid application — purchasing tickets.");
        await (0, applicationEmails_js_1.emailPurchasingTickets)(ctx);
        loaded = (await (0, applications_js_1.loadApplication)(id));
    }
    res.json({
        ...loaded,
        customer: {
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
        },
    });
}));
const quoteLineExtraSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(120),
    description: zod_1.z.string().max(500).default(""),
    amountMwk: zod_1.z.number().positive(),
});
const quoteSchema = zod_1.z.object({
    isAlternateOffer: zod_1.z.boolean().default(false),
    quotedOriginCode: zod_1.z.string().length(3).optional(),
    quotedDestinationCode: zod_1.z.string().length(3).optional(),
    quotedDepartDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    quotedDepartTime: zod_1.z.string().max(20).optional(),
    quotedReturnDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    quotedReturnTime: zod_1.z.string().max(20).optional(),
    quotedCabinClass: zod_1.z.string().optional(),
    quotedAirline: zod_1.z.string().max(120).optional(),
    quotedFlightNumber: zod_1.z.string().max(30).optional(),
    quotedPriceMwk: zod_1.z.number().positive(),
    extraChargesMwk: zod_1.z.number().min(0).optional(),
    extraChargesNote: zod_1.z.string().max(1000).optional(),
    hotel: zod_1.z
        .object({
        hotelName: zod_1.z.string().min(1).max(200),
        nights: zod_1.z.string().max(20).optional(),
        roomType: zod_1.z.string().max(120).optional(),
        amountMwk: zod_1.z.number().positive(),
    })
        .optional()
        .nullable(),
    carRental: zod_1.z
        .object({
        provider: zod_1.z.string().min(1).max(200),
        vehicle: zod_1.z.string().min(1).max(200),
        days: zod_1.z.string().max(20).optional(),
        amountMwk: zod_1.z.number().positive(),
    })
        .optional()
        .nullable(),
    extras: zod_1.z.array(quoteLineExtraSchema).optional().default([]),
    adminMessage: zod_1.z.string().max(2000).optional(),
    exchangeRates: zod_1.z.record(zod_1.z.string(), zod_1.z.number().positive()).optional(),
});
async function applyQuoteUpdate(id, body, loaded, options) {
    const legacyExtras = body.extras && body.extras.length > 0
        ? body.extras
        : body.extraChargesMwk && body.extraChargesMwk > 0
            ? [
                {
                    label: "Extra charges",
                    description: body.extraChargesNote ?? "",
                    amountMwk: body.extraChargesMwk,
                },
            ]
            : [];
    const quoteLineItems = (0, quoteLineItems_js_1.buildQuoteLineItemsFromAdmin)({
        quotedPriceMwk: body.quotedPriceMwk,
        hotel: body.hotel ?? null,
        carRental: body.carRental ?? null,
        extras: legacyExtras,
    });
    const totals = (0, quoteLineItems_js_1.quoteTotals)(quoteLineItems);
    const exchangeRatesJson = body.exchangeRates && Object.keys(body.exchangeRates).length > 0
        ? JSON.stringify(Object.fromEntries(Object.entries(body.exchangeRates).map(([k, v]) => [k.toUpperCase(), v])))
        : null;
    await pool_js_1.pool.execute(`UPDATE flight_applications SET
      ${options.setAwaitingPayment ? "status = 'awaiting_payment'," : ""}
      is_alternate_offer = :isAlternate,
      quoted_origin_code = :quotedOriginCode,
      quoted_destination_code = :quotedDestinationCode,
      quoted_depart_date = :quotedDepartDate,
      quoted_depart_time = :quotedDepartTime,
      quoted_return_date = :quotedReturnDate,
      quoted_return_time = :quotedReturnTime,
      quoted_cabin_class = :quotedCabinClass,
      quoted_airline = :quotedAirline,
      quoted_flight_number = :quotedFlightNumber,
      quoted_price_mwk = :quotedPriceMwk,
      extra_charges_mwk = :extraChargesMwk,
      extra_charges_note = :extraChargesNote,
      quote_line_items = :quoteLineItems,
      quote_exchange_rates = COALESCE(:exchangeRates, quote_exchange_rates),
      admin_message = :adminMessage
     WHERE id = :id`, {
        id,
        isAlternate: body.isAlternateOffer ? 1 : 0,
        quotedOriginCode: (body.quotedOriginCode ?? loaded.raw.origin_code).toString().toUpperCase(),
        quotedDestinationCode: (body.quotedDestinationCode ?? loaded.raw.destination_code).toString().toUpperCase(),
        quotedDepartDate: body.quotedDepartDate ?? loaded.raw.depart_date,
        quotedDepartTime: body.quotedDepartTime ?? loaded.raw.depart_time_preferred,
        quotedReturnDate: body.quotedReturnDate ?? loaded.raw.return_date,
        quotedReturnTime: body.quotedReturnTime ?? loaded.raw.return_time_preferred,
        quotedCabinClass: body.quotedCabinClass ?? loaded.raw.cabin_class,
        quotedAirline: body.quotedAirline ?? null,
        quotedFlightNumber: body.quotedFlightNumber ?? null,
        quotedPriceMwk: body.quotedPriceMwk,
        extraChargesMwk: totals.extrasMwk,
        extraChargesNote: body.extraChargesNote ?? null,
        quoteLineItems: JSON.stringify(quoteLineItems),
        exchangeRates: exchangeRatesJson,
        adminMessage: body.adminMessage ?? null,
    });
    return { quoteLineItems, totals };
}
exports.adminApplicationsRouter.post("/:id/quote", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const body = quoteSchema.parse(req.body);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded)
        throw new errorHandler_js_1.AppError(404, "Application not found");
    if (!["in_review", "pending"].includes(loaded.application.status)) {
        throw new errorHandler_js_1.AppError(409, "Application cannot be quoted in current status");
    }
    const { quoteLineItems, totals } = await applyQuoteUpdate(id, body, loaded, {
        setAwaitingPayment: true,
    });
    await (0, applications_js_1.recordApplicationEvent)(id, body.isAlternateOffer ? "alternate_quoted" : "quoted", body.isAlternateOffer ? "Admin sent alternate availability quote." : "Admin sent matching quote.");
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: loaded.raw.user_id });
    const user = users[0];
    const [updated] = await pool_js_1.pool.execute(`SELECT * FROM flight_applications WHERE id = :id`, { id });
    const ctx = (0, applications_js_1.emailContextFromRow)(updated[0], `${user.first_name} ${user.last_name}`, user.email);
    await (0, applicationEmails_js_1.emailApplicationQuoted)({
        ctx,
        priceMwk: body.quotedPriceMwk,
        extraChargesMwk: totals.extrasMwk,
        extraNote: body.extraChargesNote ?? null,
        isAlternate: body.isAlternateOffer,
        adminMessage: body.adminMessage ?? null,
        quotedSummary: (0, applications_js_1.quotedSummaryFromRow)(updated[0]),
        lineItemsSummary: (0, quoteLineItems_js_1.quoteLineItemsSummary)(quoteLineItems),
        totalMwk: totals.totalMwk,
    });
    res.json({ message: "Quote submitted", status: "awaiting_payment" });
}));
exports.adminApplicationsRouter.patch("/:id/quote", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const body = quoteSchema.parse(req.body);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded)
        throw new errorHandler_js_1.AppError(404, "Application not found");
    if (loaded.application.status !== "awaiting_payment") {
        throw new errorHandler_js_1.AppError(409, "Only awaiting-payment quotes can be edited");
    }
    const { totals } = await applyQuoteUpdate(id, body, loaded, { setAwaitingPayment: false });
    await (0, applications_js_1.recordApplicationEvent)(id, "quote_updated", "Admin updated the sent quote.");
    res.json({
        message: "Quote updated",
        status: "awaiting_payment",
        totalPriceMwk: totals.totalMwk,
    });
}));
const ticketSchema = zod_1.z.object({
    fileName: zod_1.z.string().min(1).max(255),
    mimeType: zod_1.z.string().default("application/pdf"),
    fileBase64: zod_1.z.string().min(1),
    bookingNumber: zod_1.z.string().min(1).max(20),
    seat: zod_1.z.string().min(1).max(20),
    airline: zod_1.z.string().min(1).max(120),
    flightNumber: zod_1.z.string().min(1).max(30),
    gate: zod_1.z.string().max(20).optional(),
    departAt: zod_1.z.string().datetime(),
    arriveAt: zod_1.z.string().datetime(),
    passengerNames: zod_1.z.string().min(1).max(500),
    cabinClass: zod_1.z.string().min(1).max(50).optional(),
});
exports.adminApplicationsRouter.post("/:id/tickets", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const body = ticketSchema.parse(req.body);
    const loaded = await (0, applications_js_1.loadApplication)(id);
    if (!loaded)
        throw new errorHandler_js_1.AppError(404, "Application not found");
    if (!["paid", "purchasing"].includes(loaded.application.status)) {
        throw new errorHandler_js_1.AppError(409, "Tickets can only be uploaded after payment");
    }
    const required = loaded.requiredTicketCount;
    const uploaded = loaded.uploadedTicketCount;
    if (uploaded >= required) {
        throw new errorHandler_js_1.AppError(409, `All ${required} ticket(s) have already been uploaded for this application`);
    }
    const buffer = Buffer.from(body.fileBase64, "base64");
    if (buffer.length > 8 * 1024 * 1024)
        throw new errorHandler_js_1.AppError(400, "File too large (max 8MB)");
    const appTicketId = (0, uuid_1.v4)();
    const ticketRecordId = (0, uuid_1.v4)();
    const userId = loaded.raw.user_id;
    const row = loaded.raw;
    const segmentOrder = uploaded + 1;
    const originCode = (row.quoted_origin_code ?? row.origin_code);
    const destCode = (row.quoted_destination_code ?? row.destination_code);
    const originCity = row.origin_city;
    const destCity = row.destination_city;
    const departAt = new Date(body.departAt);
    const arriveAt = new Date(body.arriveAt);
    const airline = body.airline;
    const flightNumber = body.flightNumber;
    const cabinClass = body.cabinClass ?? (row.quoted_cabin_class ?? row.cabin_class);
    const priceMwk = Number(row.quoted_price_mwk ?? 0) + Number(row.extra_charges_mwk ?? 0);
    const pnr = body.bookingNumber.toUpperCase().replace(/\s/g, "");
    let bookingId = row.booking_id;
    if (!bookingId) {
        bookingId = (0, uuid_1.v4)();
        await pool_js_1.pool.execute(`INSERT INTO bookings (
          id, user_id, pnr, status,
          origin_code, origin_city, destination_code, destination_city,
          airline, flight_number, depart_at, arrive_at, cabin_class, price_mwk
        ) VALUES (
          :bookingId, :userId, :pnr, 'confirmed',
          :originCode, :originCity, :destCode, :destCity,
          :airline, :flightNumber, :departAt, :arriveAt, :cabinClass, :priceMwk
        )`, {
            bookingId,
            userId,
            pnr,
            originCode,
            originCity,
            destCode,
            destCity,
            airline,
            flightNumber,
            departAt,
            arriveAt,
            cabinClass,
            priceMwk,
        });
        await pool_js_1.pool.execute(`UPDATE flight_applications SET status = 'purchasing', booking_id = :bookingId WHERE id = :id`, { id, bookingId });
    }
    await pool_js_1.pool.execute(`INSERT INTO tickets (
        id, booking_id, user_id, passenger_names, segment_order,
        origin_code, destination_code, origin_city, destination_city,
        depart_at, arrive_at, airline, flight_label, seat, gate, class, status
      ) VALUES (
        :id, :bookingId, :userId, :passengerNames, :segmentOrder,
        :originCode, :destCode, :originCity, :destCity,
        :departAt, :arriveAt, :airline, :flightLabel, :seat, :gate, :cabinClass, 'confirmed'
      )`, {
        id: ticketRecordId,
        bookingId,
        userId,
        passengerNames: body.passengerNames,
        segmentOrder,
        originCode,
        destCode,
        originCity,
        destCity,
        departAt,
        arriveAt,
        airline,
        flightLabel: flightNumber,
        seat: body.seat,
        gate: body.gate ?? null,
        cabinClass,
    });
    const filePath = await (0, fileStorage_js_1.saveTicketFile)(id, appTicketId, body.fileName, buffer);
    await pool_js_1.pool.execute(`INSERT INTO flight_application_tickets (
        id, application_id, ticket_record_id, segment_order, file_name, mime_type, file_path, uploaded_by
      ) VALUES (
        :id, :applicationId, :ticketRecordId, :segmentOrder, :fileName, :mimeType, :filePath, :uploadedBy
      )`, {
        id: appTicketId,
        applicationId: id,
        ticketRecordId,
        segmentOrder,
        fileName: body.fileName,
        mimeType: body.mimeType,
        filePath,
        uploadedBy: req.user.id,
    });
    const slotLabel = (0, ticketFulfillment_js_1.ticketSlotLabel)({
        index: uploaded,
        passengerCount: loaded.application.passengers.length,
        tripType: loaded.application.tripType,
        passengers: loaded.application.passengers.map((p) => ({
            firstName: p.firstName,
            lastName: p.lastName,
        })),
    });
    await (0, applications_js_1.recordApplicationEvent)(id, "ticket_uploaded", `Ticket uploaded (${segmentOrder} of ${required}): ${slotLabel} · ${body.passengerNames}.`);
    const newUploadedCount = uploaded + 1;
    const allUploaded = newUploadedCount >= required;
    if (allUploaded) {
        await pool_js_1.pool.execute(`UPDATE flight_applications SET status = 'completed', completed_at = UTC_TIMESTAMP() WHERE id = :id`, { id });
        const auditSummary = `Application ${loaded.application.referenceNumber} completed.\nRoute: ${loaded.application.originCode}→${loaded.application.destinationCode}\nTickets uploaded: ${required}\nPassengers: ${loaded.application.passengers.length}\nTotal paid: MWK ${loaded.application.totalPriceMwk.toLocaleString()}`;
        await (0, applications_js_1.recordApplicationEvent)(id, "completed", `All ${required} ticket(s) uploaded — application completed.`);
        const [allTicketFiles] = await pool_js_1.pool.execute(`SELECT file_name, mime_type, file_path, file_data FROM flight_application_tickets WHERE application_id = :id ORDER BY segment_order ASC`, { id });
        const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :uid`, { uid: loaded.raw.user_id });
        const user = users[0];
        const ctx = (0, applications_js_1.emailContextFromRow)(loaded.raw, `${user.first_name} ${user.last_name}`, user.email);
        const attachments = await Promise.all(allTicketFiles.map(async (f) => ({
            filename: f.file_name,
            content: await (0, fileStorage_js_1.loadTicketFileContent)(f),
            contentType: f.mime_type,
        })));
        await (0, applicationEmails_js_1.emailApplicationCompleted)({
            ctx,
            auditSummary,
            attachments,
        });
        res.status(201).json({
            id: appTicketId,
            uploaded: newUploadedCount,
            required,
            completed: true,
            message: `All ${required} ticket(s) uploaded — customer notified`,
        });
        return;
    }
    res.status(201).json({
        id: appTicketId,
        uploaded: newUploadedCount,
        required,
        completed: false,
        message: `Ticket ${newUploadedCount} of ${required} saved — upload remaining ticket(s) to complete the order`,
    });
}));
exports.adminApplicationsRouter.get("/:id/tickets/:ticketId", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const applicationId = zod_1.z.string().uuid().parse(req.params.id);
    const ticketId = zod_1.z.string().uuid().parse(req.params.ticketId);
    const [tickets] = await pool_js_1.pool.execute(`SELECT file_name, mime_type, file_path, file_data FROM flight_application_tickets WHERE id = :id AND application_id = :applicationId`, { id: ticketId, applicationId });
    const ticket = tickets[0];
    if (!ticket)
        throw new errorHandler_js_1.AppError(404, "Ticket not found");
    const content = await (0, fileStorage_js_1.loadTicketFileContent)(ticket);
    res.setHeader("Content-Type", ticket.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${ticket.file_name}"`);
    res.send(content);
}));
