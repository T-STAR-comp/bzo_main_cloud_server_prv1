import type { RowDataPacket } from "mysql2";
import type { Pool as PromisePool } from "mysql2/promise";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import {
  parseQuoteLineItems,
  quoteTotals,
  type QuoteLineItem,
} from "./quoteLineItems.js";
import { parseQuoteExchangeRates } from "./currency.js";
import {
  mapApplicationTicketRow,
  requiredTicketCount,
} from "./ticketFulfillment.js";

type QueryExecutor = Pick<PromisePool, "execute">;

export function generateReferenceNumber() {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BZ-${new Date().getFullYear()}-${suffix}`;
}

export async function recordApplicationEvent(
  applicationId: string,
  eventType: string,
  message: string,
  executor: QueryExecutor = pool,
) {
  await executor.execute(
    `INSERT INTO flight_application_events (id, application_id, event_type, message) VALUES (:id, :applicationId, :eventType, :message)`,
    { id: uuid(), applicationId, eventType, message },
  );
}

export function resolveQuoteLineItems(row: RowDataPacket): QuoteLineItem[] {
  const parsed = parseQuoteLineItems(row.quote_line_items);
  if (parsed.length > 0) return parsed;

  const items: QuoteLineItem[] = [];
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

export function mapApplication(row: RowDataPacket, passengers: RowDataPacket[] = []) {
  const quoteLineItems = resolveQuoteLineItems(row);
  const totals = quoteTotals(quoteLineItems);
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
      ? new Date(row.opened_by_admin_at as string).toISOString()
      : null,
    paidAt: row.paid_at ? new Date(row.paid_at as string).toISOString() : null,
    paidCurrency: row.paid_currency ? String(row.paid_currency) : null,
    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
    customerDisplayCurrency: row.customer_display_currency ? String(row.customer_display_currency) : null,
    quoteExchangeRates: parseQuoteExchangeRates(row.quote_exchange_rates),
    completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    passengers: passengers.map(mapPassenger),
    quoteLineItems,
    totalPriceMwk: totals.totalMwk,
    requiredTicketCount: requiredTicketCount({
      passengerCount: passengers.length,
      tripType: row.trip_type as string,
    }),
  };
}

export function mapPassenger(row: RowDataPacket) {
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

export async function loadApplication(applicationId: string) {
  const [apps] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM flight_applications WHERE id = :id`,
    { id: applicationId },
  );
  const app = apps[0];
  if (!app) return null;

  const [passengers] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM flight_application_passengers WHERE application_id = :id ORDER BY sort_order`,
    { id: applicationId },
  );

  const [events] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM flight_application_events WHERE application_id = :id ORDER BY created_at ASC`,
    { id: applicationId },
  );

  const [tickets] = await pool.execute<RowDataPacket[]>(
    `SELECT fat.*, t.passenger_names, t.seat, t.airline, t.flight_label, t.gate,
            t.depart_at, t.arrive_at, t.class, b.pnr
     FROM flight_application_tickets fat
     LEFT JOIN tickets t ON t.id = fat.ticket_record_id
     LEFT JOIN bookings b ON b.id = t.booking_id
     WHERE fat.application_id = :id
     ORDER BY fat.segment_order ASC, fat.created_at ASC`,
    { id: applicationId },
  );

  const mappedTickets = tickets.map(mapApplicationTicketRow);

  return {
    application: mapApplication(app, passengers),
    events: events.map((e) => ({
      eventType: e.event_type,
      message: e.message,
      createdAt: new Date(e.created_at as string).toISOString(),
    })),
    tickets: mappedTickets,
    uploadedTicketCount: mappedTickets.length,
    requiredTicketCount: requiredTicketCount({
      passengerCount: passengers.length,
      tripType: app.trip_type as string,
    }),
    raw: app,
  };
}

export function emailContextFromRow(row: RowDataPacket, customerName: string, customerEmail: string) {
  const departDate =
    row.depart_date instanceof Date ? row.depart_date.toISOString().slice(0, 10) : String(row.depart_date);
  const destCode = (row.quoted_destination_code ?? row.destination_code) as string;
  const destCity = (row.quoted_destination_city ?? row.destination_city ?? row.destination_code) as string;
  return {
    referenceNumber: row.reference_number as string,
    customerName,
    customerEmail,
    userId: row.user_id as string | undefined,
    origin: `${row.origin_city} (${row.origin_code})`,
    destination: `${destCity} (${destCode})`,
    destinationCity: destCity,
    destinationCode: destCode,
    departDate,
  };
}

export function quotedSummaryFromRow(row: RowDataPacket) {
  const parts = [
    `Route: ${row.quoted_origin_code ?? row.origin_code} → ${row.quoted_destination_code ?? row.destination_code}`,
    `Depart: ${row.quoted_depart_date ?? row.depart_date} ${row.quoted_depart_time ?? row.depart_time_preferred}`,
  ];
  if (row.quoted_airline) parts.push(`Airline: ${row.quoted_airline}${row.quoted_flight_number ? ` ${row.quoted_flight_number}` : ""}`);
  if (row.quoted_cabin_class) parts.push(`Cabin: ${row.quoted_cabin_class}`);
  return parts.join("\n");
}
