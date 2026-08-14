"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flightsRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const audit_js_1 = require("../services/audit.js");
exports.flightsRouter = (0, express_1.Router)();
function extractAirportCode(input) {
    const match = input.match(/\(([A-Za-z]{3})\)/);
    if (match)
        return match[1].toUpperCase();
    const trimmed = input.trim();
    if (trimmed.length === 3)
        return trimmed.toUpperCase();
    return trimmed.slice(0, 3).toUpperCase();
}
function generatePnr() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pnr = "";
    for (let i = 0; i < 6; i++)
        pnr += chars[Math.floor(Math.random() * chars.length)];
    return pnr;
}
exports.flightsRouter.get("/search", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const query = zod_1.z
        .object({
        origin: zod_1.z.string().min(3),
        destination: zod_1.z.string().min(3),
        date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        cabinClass: zod_1.z.string().optional(),
    })
        .parse(req.query);
    const originCode = extractAirportCode(query.origin);
    const destinationCode = extractAirportCode(query.destination);
    let sql = `
      SELECT fd.*, r.origin_code, r.origin_city, r.destination_code, r.destination_city,
             r.airline, r.duration_minutes, r.base_price_mwk, r.cabin_class
      FROM flight_departures fd
      JOIN flight_routes r ON r.id = fd.route_id
      WHERE r.is_active = 1
        AND r.origin_code = :originCode
        AND r.destination_code = :destinationCode
        AND DATE(fd.depart_at) = :date
        AND fd.status IN ('scheduled', 'delayed')
        AND fd.seats_available > 0
        AND fd.depart_at > UTC_TIMESTAMP()`;
    const params = { originCode, destinationCode, date: query.date };
    if (query.cabinClass) {
        sql += ` AND r.cabin_class = :cabinClass`;
        params.cabinClass = query.cabinClass;
    }
    sql += ` ORDER BY fd.depart_at ASC LIMIT 50`;
    const [rows] = await pool_js_1.pool.execute(sql, params);
    res.json({
        results: rows.map((row) => ({
            departureId: row.id,
            routeId: row.route_id,
            flightNumber: row.flight_number,
            originCode: row.origin_code,
            originCity: row.origin_city,
            destinationCode: row.destination_code,
            destinationCity: row.destination_city,
            airline: row.airline,
            durationMinutes: Number(row.duration_minutes),
            cabinClass: row.cabin_class,
            departAt: new Date(row.depart_at).toISOString(),
            arriveAt: new Date(row.arrive_at).toISOString(),
            seatsAvailable: Number(row.seats_available),
            priceMwk: Number(row.price_mwk ?? row.base_price_mwk),
            status: row.status,
            gate: row.gate,
        })),
    });
}));
const bookSchema = zod_1.z.object({
    departureId: zod_1.z.string().uuid(),
});
exports.flightsRouter.post("/book", auth_js_1.authenticate, (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = bookSchema.parse(req.body);
    const userId = req.user.id;
    const conn = await pool_js_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        const [departures] = await conn.execute(`SELECT fd.*, r.origin_code, r.origin_city, r.destination_code, r.destination_city,
                r.airline, r.cabin_class, r.base_price_mwk
         FROM flight_departures fd
         JOIN flight_routes r ON r.id = fd.route_id
         WHERE fd.id = :id FOR UPDATE`, { id: body.departureId });
        const departure = departures[0];
        if (!departure)
            throw new errorHandler_js_1.AppError(404, "Flight not found");
        if (Number(departure.seats_available) <= 0)
            throw new errorHandler_js_1.AppError(409, "Flight is full");
        if (!["scheduled", "delayed"].includes(departure.status)) {
            throw new errorHandler_js_1.AppError(409, "Flight not available for booking");
        }
        const priceMwk = Number(departure.price_mwk ?? departure.base_price_mwk);
        const bookingId = (0, uuid_1.v4)();
        let pnr = generatePnr();
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await conn.execute(`INSERT INTO bookings (
              id, user_id, flight_departure_id, pnr, status,
              origin_code, origin_city, destination_code, destination_city,
              airline, flight_number, depart_at, arrive_at, cabin_class, price_mwk
            ) VALUES (
              :id, :userId, :departureId, :pnr, 'confirmed',
              :originCode, :originCity, :destinationCode, :destinationCity,
              :airline, :flightNumber, :departAt, :arriveAt, :cabinClass, :priceMwk
            )`, {
                    id: bookingId,
                    userId,
                    departureId: body.departureId,
                    pnr,
                    originCode: departure.origin_code,
                    originCity: departure.origin_city,
                    destinationCode: departure.destination_code,
                    destinationCity: departure.destination_city,
                    airline: departure.airline,
                    flightNumber: departure.flight_number,
                    departAt: departure.depart_at,
                    arriveAt: departure.arrive_at,
                    cabinClass: departure.cabin_class,
                    priceMwk,
                });
                break;
            }
            catch (err) {
                const code = err.code;
                if (code === "ER_DUP_ENTRY") {
                    pnr = generatePnr();
                    continue;
                }
                throw err;
            }
        }
        const ticketId = (0, uuid_1.v4)();
        await conn.execute(`INSERT INTO tickets (
          id, booking_id, user_id, segment_order,
          origin_code, destination_code, origin_city, destination_city,
          depart_at, arrive_at, airline, flight_label, gate, class, status
        ) VALUES (
          :id, :bookingId, :userId, 1,
          :originCode, :destinationCode, :originCity, :destinationCity,
          :departAt, :arriveAt, :airline, :flightLabel, :gate, :cabinClass, 'confirmed'
        )`, {
            id: ticketId,
            bookingId,
            userId,
            originCode: departure.origin_code,
            destinationCode: departure.destination_code,
            originCity: departure.origin_city,
            destinationCity: departure.destination_city,
            departAt: departure.depart_at,
            arriveAt: departure.arrive_at,
            airline: departure.airline,
            flightLabel: departure.flight_number,
            gate: departure.gate,
            cabinClass: departure.cabin_class,
        });
        const newAvailable = Number(departure.seats_available) - 1;
        await conn.execute(`UPDATE flight_departures SET seats_available = :seats, status = IF(:seats = 0, 'full', status) WHERE id = :id`, { seats: newAvailable, id: body.departureId });
        const financeId = (0, uuid_1.v4)();
        await conn.execute(`INSERT INTO finance_ledger (id, user_id, booking_id, entry_type, amount_mwk, description, reference)
         VALUES (:id, :userId, :bookingId, 'payment', :amount, :description, :pnr)`, {
            id: financeId,
            userId,
            bookingId,
            amount: priceMwk,
            description: `Flight booking ${departure.origin_code}→${departure.destination_code}`,
            pnr,
        });
        await conn.commit();
        await (0, audit_js_1.writeAuditLog)({
            userId,
            action: "booking.created",
            metadata: { bookingId, pnr, departureId: body.departureId },
            ipAddress: req.ip ?? null,
        });
        res.status(201).json({
            bookingId,
            pnr,
            priceMwk,
            message: "Flight booked successfully",
        });
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}));
