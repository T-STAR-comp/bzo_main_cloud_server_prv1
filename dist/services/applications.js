"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReferenceNumber = generateReferenceNumber;
exports.recordApplicationEvent = recordApplicationEvent;
exports.resolveQuoteLineItems = resolveQuoteLineItems;
exports.mapApplication = mapApplication;
exports.mapPassenger = mapPassenger;
exports.loadApplication = loadApplication;
exports.emailContextFromRow = emailContextFromRow;
exports.quotedSummaryFromRow = quotedSummaryFromRow;
const uuid_1 = require("uuid");
const pool_js_1 = require("../db/pool.js");
const quoteLineItems_js_1 = require("./quoteLineItems.js");
const currency_js_1 = require("./currency.js");
const ticketFulfillment_js_1 = require("./ticketFulfillment.js");
function generateReferenceNumber() {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BZ-${new Date().getFullYear()}-${suffix}`;
}
async function recordApplicationEvent(applicationId, eventType, message, executor = pool_js_1.pool) {
    await executor.execute(`INSERT INTO flight_application_events (id, application_id, event_type, message) VALUES (:id, :applicationId, :eventType, :message)`, { id: (0, uuid_1.v4)(), applicationId, eventType, message });
}
function resolveQuoteLineItems(row) {
    const parsed = (0, quoteLineItems_js_1.parseQuoteLineItems)(row.quote_line_items);
    if (parsed.length > 0)
        return parsed;
    const items = [];
    const fare = row.quoted_price_mwk ? Number(row.quoted_price_mwk) : 0;
    if (fare > 0) {
        items.push({
            id: "fare",
            type: "fare",
            label: "Flight fare",
            description: "Main airfare for quoted itinerary",
            amountMwk: fare,
            removable: false,
        });
    }
    const extras = row.extra_charges_mwk ? Number(row.extra_charges_mwk) : 0;
    if (extras > 0) {
        items.push({
            id: "legacy-extra",
            type: "extra",
            label: "Extra charges",
            description: row.extra_charges_note ? String(row.extra_charges_note) : "Additional charges",
            amountMwk: extras,
            removable: false,
        });
    }
    return items;
}
function mapApplication(row, passengers = []) {
    const quoteLineItems = resolveQuoteLineItems(row);
    const totals = (0, quoteLineItems_js_1.quoteTotals)(quoteLineItems);
    return {
        id: row.id,
        referenceNumber: row.reference_number,
        status: row.status,
        originCode: row.origin_code,
        originCity: row.origin_city,
        destinationCode: row.destination_code,
        destinationCity: row.destination_city,
        tripType: row.trip_type,
        departDate: row.depart_date instanceof Date ? row.depart_date.toISOString().slice(0, 10) : row.depart_date,
        departTimePreferred: row.depart_time_preferred,
        returnDate: row.return_date
            ? row.return_date instanceof Date
                ? row.return_date.toISOString().slice(0, 10)
                : row.return_date
            : null,
        returnTimePreferred: row.return_time_preferred,
        contactPhone: row.contact_phone,
        contactWhatsapp: row.contact_whatsapp,
        cabinClass: row.cabin_class,
        needCarRental: Boolean(row.need_car_rental),
        needHotel: Boolean(row.need_hotel),
        hotelRequestDetails: row.hotel_request_details ? String(row.hotel_request_details) : null,
        carRentalRequestDetails: row.car_rental_request_details ? String(row.car_rental_request_details) : null,
        specialWheelchair: Boolean(row.special_wheelchair),
        wheelchairReason: row.wheelchair_reason,
        specialMeals: Boolean(row.special_meals),
        mealsReason: row.meals_reason,
        specialSeat: Boolean(row.special_seat),
        seatPreference: row.seat_preference,
        quotedOriginCode: row.quoted_origin_code,
        quotedDestinationCode: row.quoted_destination_code,
        quotedDepartDate: row.quoted_depart_date
            ? row.quoted_depart_date instanceof Date
                ? row.quoted_depart_date.toISOString().slice(0, 10)
                : row.quoted_depart_date
            : null,
        quotedDepartTime: row.quoted_depart_time,
        quotedReturnDate: row.quoted_return_date
            ? row.quoted_return_date instanceof Date
                ? row.quoted_return_date.toISOString().slice(0, 10)
                : row.quoted_return_date
            : null,
        quotedReturnTime: row.quoted_return_time,
        quotedCabinClass: row.quoted_cabin_class,
        quotedAirline: row.quoted_airline,
        quotedFlightNumber: row.quoted_flight_number,
        quotedPriceMwk: row.quoted_price_mwk ? Number(row.quoted_price_mwk) : null,
        extraChargesMwk: row.extra_charges_mwk ? Number(row.extra_charges_mwk) : 0,
        extraChargesNote: row.extra_charges_note,
        isAlternateOffer: Boolean(row.is_alternate_offer),
        adminMessage: row.admin_message,
        openedByAdminAt: row.opened_by_admin_at
            ? new Date(row.opened_by_admin_at).toISOString()
            : null,
        paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
        paidCurrency: row.paid_currency ? String(row.paid_currency) : null,
        paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
        customerDisplayCurrency: row.customer_display_currency ? String(row.customer_display_currency) : null,
        quoteExchangeRates: (0, currency_js_1.parseQuoteExchangeRates)(row.quote_exchange_rates),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        passengers: passengers.map(mapPassenger),
        quoteLineItems,
        totalPriceMwk: totals.totalMwk,
        requiredTicketCount: (0, ticketFulfillment_js_1.requiredTicketCount)({
            passengerCount: passengers.length,
            tripType: row.trip_type,
        }),
    };
}
function mapPassenger(row) {
    return {
        id: row.id,
        passengerType: row.passenger_type,
        firstName: row.first_name,
        lastName: row.last_name,
        dateOfBirth: row.date_of_birth
            ? row.date_of_birth instanceof Date
                ? row.date_of_birth.toISOString().slice(0, 10)
                : row.date_of_birth
            : null,
        ageYears: row.age_years != null ? Number(row.age_years) : null,
        isAccompanied: row.is_accompanied != null ? Boolean(row.is_accompanied) : null,
        infantSeatBooked: row.infant_seat_booked != null ? Boolean(row.infant_seat_booked) : null,
    };
}
async function loadApplication(applicationId) {
    const [apps] = await pool_js_1.pool.execute(`SELECT * FROM flight_applications WHERE id = :id`, { id: applicationId });
    const app = apps[0];
    if (!app)
        return null;
    const [passengers] = await pool_js_1.pool.execute(`SELECT * FROM flight_application_passengers WHERE application_id = :id ORDER BY sort_order`, { id: applicationId });
    const [events] = await pool_js_1.pool.execute(`SELECT * FROM flight_application_events WHERE application_id = :id ORDER BY created_at ASC`, { id: applicationId });
    const [tickets] = await pool_js_1.pool.execute(`SELECT fat.*, t.passenger_names, t.seat, t.airline, t.flight_label, t.gate,
            t.depart_at, t.arrive_at, t.class, b.pnr
     FROM flight_application_tickets fat
     LEFT JOIN tickets t ON t.id = fat.ticket_record_id
     LEFT JOIN bookings b ON b.id = t.booking_id
     WHERE fat.application_id = :id
     ORDER BY fat.segment_order ASC, fat.created_at ASC`, { id: applicationId });
    const mappedTickets = tickets.map(ticketFulfillment_js_1.mapApplicationTicketRow);
    return {
        application: mapApplication(app, passengers),
        events: events.map((e) => ({
            eventType: e.event_type,
            message: e.message,
            createdAt: new Date(e.created_at).toISOString(),
        })),
        tickets: mappedTickets,
        uploadedTicketCount: mappedTickets.length,
        requiredTicketCount: (0, ticketFulfillment_js_1.requiredTicketCount)({
            passengerCount: passengers.length,
            tripType: app.trip_type,
        }),
        raw: app,
    };
}
function emailContextFromRow(row, customerName, customerEmail) {
    const departDate = row.depart_date instanceof Date ? row.depart_date.toISOString().slice(0, 10) : String(row.depart_date);
    const destCode = (row.quoted_destination_code ?? row.destination_code);
    const destCity = (row.quoted_destination_city ?? row.destination_city ?? row.destination_code);
    return {
        referenceNumber: row.reference_number,
        customerName,
        customerEmail,
        userId: row.user_id,
        origin: `${row.origin_city} (${row.origin_code})`,
        destination: `${destCity} (${destCode})`,
        destinationCity: destCity,
        destinationCode: destCode,
        departDate,
    };
}
function quotedSummaryFromRow(row) {
    const parts = [
        `Route: ${row.quoted_origin_code ?? row.origin_code} → ${row.quoted_destination_code ?? row.destination_code}`,
        `Depart: ${row.quoted_depart_date ?? row.depart_date} ${row.quoted_depart_time ?? row.depart_time_preferred}`,
    ];
    if (row.quoted_airline)
        parts.push(`Airline: ${row.quoted_airline}${row.quoted_flight_number ? ` ${row.quoted_flight_number}` : ""}`);
    if (row.quoted_cabin_class)
        parts.push(`Cabin: ${row.quoted_cabin_class}`);
    return parts.join("\n");
}
