"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDepartureReminders = runDepartureReminders;
exports.startDepartureReminderScheduler = startDepartureReminderScheduler;
const pool_js_1 = require("../db/pool.js");
const logger_js_1 = require("../logger.js");
const applicationEmails_js_1 = require("./applicationEmails.js");
const destinationFunFacts_js_1 = require("./destinationFunFacts.js");
const ticketUtils_js_1 = require("./ticketUtils.js");
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
async function ticketsDueReminder(reminderType) {
    const dayOffset = reminderType === "week_before" ? 7 : 1;
    const [rows] = await pool_js_1.pool.execute(`SELECT t.*, u.email, u.first_name, u.last_name, b.pnr, fa.reference_number
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     JOIN bookings b ON b.id = t.booking_id
     LEFT JOIN flight_applications fa ON fa.booking_id = t.booking_id
     LEFT JOIN ticket_departure_reminders r
       ON r.ticket_id = t.id AND r.reminder_type = :reminderType
     WHERE t.status = 'confirmed'
       AND t.depart_at > UTC_TIMESTAMP()
       AND DATE(t.depart_at) = DATE(UTC_TIMESTAMP() + INTERVAL :dayOffset DAY)
       AND r.id IS NULL
     ORDER BY t.depart_at ASC`, { reminderType, dayOffset });
    return rows.filter((row) => (0, ticketUtils_js_1.ticketDisplayStatus)(row.depart_at, row.status) === "active");
}
async function runDepartureReminders() {
    for (const reminderType of ["week_before", "day_before"]) {
        const tickets = await ticketsDueReminder(reminderType);
        for (const ticket of tickets) {
            try {
                const fun = await (0, destinationFunFacts_js_1.pickFunFactForUser)({
                    userId: ticket.user_id,
                    destinationCode: ticket.destination_code,
                    destinationCity: ticket.destination_city,
                    context: reminderType === "week_before" ? "week_reminder" : "day_reminder",
                });
                const payload = {
                    customerName: `${ticket.first_name} ${ticket.last_name}`,
                    customerEmail: ticket.email,
                    pnr: ticket.pnr,
                    referenceNumber: ticket.reference_number,
                    originCity: ticket.origin_city,
                    destinationCity: ticket.destination_city,
                    destinationCode: ticket.destination_code,
                    departAt: new Date(ticket.depart_at).toISOString(),
                    airline: ticket.airline,
                    flightLabel: ticket.flight_label,
                    seat: ticket.seat,
                    gate: ticket.gate,
                    funFact: fun.fact,
                    destinationLabel: fun.label,
                };
                if (reminderType === "week_before") {
                    await (0, applicationEmails_js_1.emailDepartureWeekBeforeReminder)(payload);
                }
                else {
                    await (0, applicationEmails_js_1.emailDepartureDayBeforeReminder)(payload);
                }
                await pool_js_1.pool.execute(`INSERT INTO ticket_departure_reminders (id, ticket_id, user_id, reminder_type)
           VALUES (UUID(), :ticketId, :userId, :reminderType)`, { ticketId: ticket.id, userId: ticket.user_id, reminderType });
                logger_js_1.logger.info(`${reminderType} reminder sent for ticket ${ticket.id}`);
            }
            catch (error) {
                logger_js_1.logger.error(`Failed ${reminderType} reminder for ticket ${ticket.id}`, error);
            }
        }
    }
}
function startDepartureReminderScheduler() {
    const safeRun = () => {
        void runDepartureReminders().catch((error) => {
            logger_js_1.logger.error("Departure reminder run failed", error);
        });
    };
    safeRun();
    setInterval(safeRun, CHECK_INTERVAL_MS);
    logger_js_1.logger.info("Departure reminder scheduler started");
}
