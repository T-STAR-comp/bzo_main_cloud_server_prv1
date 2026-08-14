import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import {
  emailDepartureDayBeforeReminder,
  emailDepartureWeekBeforeReminder,
} from "./applicationEmails.js";
import { pickFunFactForUser } from "./destinationFunFacts.js";
import { ticketDisplayStatus } from "./ticketUtils.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

type ReminderRow = RowDataPacket & {
  id: string;
  user_id: string;
  origin_city: string;
  destination_code: string;
  destination_city: string;
  depart_at: Date;
  airline: string;
  flight_label: string | null;
  seat: string | null;
  gate: string | null;
  status: string;
  email: string;
  first_name: string;
  last_name: string;
  pnr: string;
  reference_number: string | null;
};

async function ticketsDueReminder(reminderType: "week_before" | "day_before") {
  const dayOffset = reminderType === "week_before" ? 7 : 1;

  const [rows] = await pool.execute<ReminderRow[]>(
    `SELECT t.*, u.email, u.first_name, u.last_name, b.pnr, fa.reference_number
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
     ORDER BY t.depart_at ASC`,
    { reminderType, dayOffset },
  );

  return rows.filter((row) => ticketDisplayStatus(row.depart_at, row.status) === "active");
}

export async function runDepartureReminders() {
  for (const reminderType of ["week_before", "day_before"] as const) {
    const tickets = await ticketsDueReminder(reminderType);
    for (const ticket of tickets) {
      try {
        const fun = await pickFunFactForUser({
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
          await emailDepartureWeekBeforeReminder(payload);
        } else {
          await emailDepartureDayBeforeReminder(payload);
        }

        await pool.execute(
          `INSERT INTO ticket_departure_reminders (id, ticket_id, user_id, reminder_type)
           VALUES (UUID(), :ticketId, :userId, :reminderType)`,
          { ticketId: ticket.id, userId: ticket.user_id, reminderType },
        );

        logger.info(`${reminderType} reminder sent for ticket ${ticket.id}`);
      } catch (error) {
        logger.error(`Failed ${reminderType} reminder for ticket ${ticket.id}`, error);
      }
    }
  }
}

export function startDepartureReminderScheduler() {
  const safeRun = () => {
    void runDepartureReminders().catch((error) => {
      logger.error("Departure reminder run failed", error);
    });
  };
  safeRun();
  setInterval(safeRun, CHECK_INTERVAL_MS);
  logger.info("Departure reminder scheduler started");
}
