import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate, requireAdmin, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/errorHandler.js";
import {
  emailApplicationCompleted,
  emailApplicationInReview,
  emailApplicationQuoted,
  emailPurchasingTickets,
} from "../services/applicationEmails.js";
import {
  emailContextFromRow,
  loadApplication,
  mapApplication,
  quotedSummaryFromRow,
  recordApplicationEvent,
} from "../services/applications.js";
import {
  buildQuoteLineItemsFromAdmin,
  quoteLineItemsSummary,
  quoteTotals,
} from "../services/quoteLineItems.js";
import {
  ticketSlotLabel,
} from "../services/ticketFulfillment.js";
import { loadTicketFileContent, saveTicketFile } from "../services/fileStorage.js";

export const adminApplicationsRouter = Router();

adminApplicationsRouter.use(authenticate, requireAdmin);

adminApplicationsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT fa.*, u.email, u.first_name, u.last_name, u.phone,
        (SELECT COUNT(*) FROM flight_application_passengers p WHERE p.application_id = fa.id) AS passenger_count
       FROM flight_applications fa
       JOIN users u ON u.id = fa.user_id
       ORDER BY fa.created_at DESC LIMIT 200`,
    );

    res.json({
      applications: rows.map((row) => ({
        ...mapApplication(row),
        customerEmail: row.email,
        customerName: `${row.first_name} ${row.last_name}`,
        customerPhone: row.phone,
        passengerCount: Number(row.passenger_count),
      })),
    });
  }),
);

adminApplicationsRouter.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    let loaded = await loadApplication(id);
    if (!loaded) throw new AppError(404, "Application not found");

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: loaded.raw.user_id },
    );
    const user = users[0];
    const ctx = emailContextFromRow(loaded.raw, `${user.first_name} ${user.last_name}`, user.email as string);

    if (loaded.application.status === "pending") {
      await pool.execute(
        `UPDATE flight_applications SET status = 'in_review', opened_by_admin_at = UTC_TIMESTAMP() WHERE id = :id`,
        { id },
      );
      await recordApplicationEvent(id, "in_review", "Admin opened application — now in review.");
      await emailApplicationInReview(ctx);
      loaded = (await loadApplication(id))!;
    } else if (loaded.application.status === "paid") {
      await pool.execute(`UPDATE flight_applications SET status = 'purchasing' WHERE id = :id`, { id });
      await recordApplicationEvent(id, "purchasing", "Admin opened paid application — purchasing tickets.");
      await emailPurchasingTickets(ctx);
      loaded = (await loadApplication(id))!;
    }

    res.json({
      ...loaded,
      customer: {
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
      },
    });
  }),
);

const quoteLineExtraSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  amountMwk: z.number().positive(),
});

const quoteSchema = z.object({
  isAlternateOffer: z.boolean().default(false),
  quotedOriginCode: z.string().length(3).optional(),
  quotedDestinationCode: z.string().length(3).optional(),
  quotedDepartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  quotedDepartTime: z.string().max(20).optional(),
  quotedReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  quotedReturnTime: z.string().max(20).optional(),
  quotedCabinClass: z.string().optional(),
  quotedAirline: z.string().max(120).optional(),
  quotedFlightNumber: z.string().max(30).optional(),
  quotedPriceMwk: z.number().positive(),
  extraChargesMwk: z.number().min(0).optional(),
  extraChargesNote: z.string().max(1000).optional(),
  hotel: z
    .object({
      hotelName: z.string().min(1).max(200),
      nights: z.string().max(20).optional(),
      roomType: z.string().max(120).optional(),
      amountMwk: z.number().positive(),
    })
    .optional()
    .nullable(),
  carRental: z
    .object({
      provider: z.string().min(1).max(200),
      vehicle: z.string().min(1).max(200),
      days: z.string().max(20).optional(),
      amountMwk: z.number().positive(),
    })
    .optional()
    .nullable(),
  extras: z.array(quoteLineExtraSchema).optional().default([]),
  adminMessage: z.string().max(2000).optional(),
  exchangeRates: z.record(z.string(), z.number().positive()).optional(),
});

async function applyQuoteUpdate(
  id: string,
  body: z.infer<typeof quoteSchema>,
  loaded: NonNullable<Awaited<ReturnType<typeof loadApplication>>>,
  options: { setAwaitingPayment: boolean },
) {
  const legacyExtras =
    body.extras && body.extras.length > 0
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

  const quoteLineItems = buildQuoteLineItemsFromAdmin({
    quotedPriceMwk: body.quotedPriceMwk,
    hotel: body.hotel ?? null,
    carRental: body.carRental ?? null,
    extras: legacyExtras,
  });
  const totals = quoteTotals(quoteLineItems);
  const exchangeRatesJson =
    body.exchangeRates && Object.keys(body.exchangeRates).length > 0
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(body.exchangeRates).map(([k, v]) => [k.toUpperCase(), v]),
          ),
        )
      : null;

  await pool.execute(
    `UPDATE flight_applications SET
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
     WHERE id = :id`,
    {
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
    },
  );

  return { quoteLineItems, totals };
}

adminApplicationsRouter.post(
  "/:id/quote",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = quoteSchema.parse(req.body);
    const loaded = await loadApplication(id);
    if (!loaded) throw new AppError(404, "Application not found");

    if (!["in_review", "pending"].includes(loaded.application.status)) {
      throw new AppError(409, "Application cannot be quoted in current status");
    }

    const { quoteLineItems, totals } = await applyQuoteUpdate(id, body, loaded, {
      setAwaitingPayment: true,
    });

    await recordApplicationEvent(
      id,
      body.isAlternateOffer ? "alternate_quoted" : "quoted",
      body.isAlternateOffer ? "Admin sent alternate availability quote." : "Admin sent matching quote.",
    );

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: loaded.raw.user_id },
    );
    const user = users[0];
    const [updated] = await pool.execute<RowDataPacket[]>(`SELECT * FROM flight_applications WHERE id = :id`, { id });

    const ctx = emailContextFromRow(updated[0], `${user.first_name} ${user.last_name}`, user.email as string);

    await emailApplicationQuoted({
      ctx,
      priceMwk: body.quotedPriceMwk,
      extraChargesMwk: totals.extrasMwk,
      extraNote: body.extraChargesNote ?? null,
      isAlternate: body.isAlternateOffer,
      adminMessage: body.adminMessage ?? null,
      quotedSummary: quotedSummaryFromRow(updated[0]),
      lineItemsSummary: quoteLineItemsSummary(quoteLineItems),
      totalMwk: totals.totalMwk,
    });

    res.json({ message: "Quote submitted", status: "awaiting_payment" });
  }),
);

adminApplicationsRouter.patch(
  "/:id/quote",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = quoteSchema.parse(req.body);
    const loaded = await loadApplication(id);
    if (!loaded) throw new AppError(404, "Application not found");

    if (loaded.application.status !== "awaiting_payment") {
      throw new AppError(409, "Only awaiting-payment quotes can be edited");
    }

    const { totals } = await applyQuoteUpdate(id, body, loaded, { setAwaitingPayment: false });

    await recordApplicationEvent(id, "quote_updated", "Admin updated the sent quote.");

    res.json({
      message: "Quote updated",
      status: "awaiting_payment",
      totalPriceMwk: totals.totalMwk,
    });
  }),
);

const ticketSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().default("application/pdf"),
  fileBase64: z.string().min(1),
  bookingNumber: z.string().min(1).max(20),
  seat: z.string().min(1).max(20),
  airline: z.string().min(1).max(120),
  flightNumber: z.string().min(1).max(30),
  gate: z.string().max(20).optional(),
  departAt: z.string().datetime(),
  arriveAt: z.string().datetime(),
  passengerNames: z.string().min(1).max(500),
  cabinClass: z.string().min(1).max(50).optional(),
});

adminApplicationsRouter.post(
  "/:id/tickets",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = ticketSchema.parse(req.body);
    const loaded = await loadApplication(id);
    if (!loaded) throw new AppError(404, "Application not found");

    if (!["paid", "purchasing"].includes(loaded.application.status)) {
      throw new AppError(409, "Tickets can only be uploaded after payment");
    }

    const required = loaded.requiredTicketCount;
    const uploaded = loaded.uploadedTicketCount;
    if (uploaded >= required) {
      throw new AppError(409, `All ${required} ticket(s) have already been uploaded for this application`);
    }

    const buffer = Buffer.from(body.fileBase64, "base64");
    if (buffer.length > 8 * 1024 * 1024) throw new AppError(400, "File too large (max 8MB)");

    const appTicketId = uuid();
    const ticketRecordId = uuid();
    const userId = loaded.raw.user_id as string;
    const row = loaded.raw;
    const segmentOrder = uploaded + 1;

    const originCode = (row.quoted_origin_code ?? row.origin_code) as string;
    const destCode = (row.quoted_destination_code ?? row.destination_code) as string;
    const originCity = row.origin_city as string;
    const destCity = row.destination_city as string;
    const departAt = new Date(body.departAt);
    const arriveAt = new Date(body.arriveAt);
    const airline = body.airline;
    const flightNumber = body.flightNumber;
    const cabinClass = body.cabinClass ?? (row.quoted_cabin_class ?? row.cabin_class) as string;
    const priceMwk = Number(row.quoted_price_mwk ?? 0) + Number(row.extra_charges_mwk ?? 0);
    const pnr = body.bookingNumber.toUpperCase().replace(/\s/g, "");

    let bookingId = row.booking_id as string | null;
    if (!bookingId) {
      bookingId = uuid();
      await pool.execute(
        `INSERT INTO bookings (
          id, user_id, pnr, status,
          origin_code, origin_city, destination_code, destination_city,
          airline, flight_number, depart_at, arrive_at, cabin_class, price_mwk
        ) VALUES (
          :bookingId, :userId, :pnr, 'confirmed',
          :originCode, :originCity, :destCode, :destCity,
          :airline, :flightNumber, :departAt, :arriveAt, :cabinClass, :priceMwk
        )`,
        {
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
        },
      );
      await pool.execute(
        `UPDATE flight_applications SET status = 'purchasing', booking_id = :bookingId WHERE id = :id`,
        { id, bookingId },
      );
    }

    await pool.execute(
      `INSERT INTO tickets (
        id, booking_id, user_id, passenger_names, segment_order,
        origin_code, destination_code, origin_city, destination_city,
        depart_at, arrive_at, airline, flight_label, seat, gate, class, status
      ) VALUES (
        :id, :bookingId, :userId, :passengerNames, :segmentOrder,
        :originCode, :destCode, :originCity, :destCity,
        :departAt, :arriveAt, :airline, :flightLabel, :seat, :gate, :cabinClass, 'confirmed'
      )`,
      {
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
      },
    );

    const filePath = await saveTicketFile(id, appTicketId, body.fileName, buffer);

    await pool.execute(
      `INSERT INTO flight_application_tickets (
        id, application_id, ticket_record_id, segment_order, file_name, mime_type, file_path, uploaded_by
      ) VALUES (
        :id, :applicationId, :ticketRecordId, :segmentOrder, :fileName, :mimeType, :filePath, :uploadedBy
      )`,
      {
        id: appTicketId,
        applicationId: id,
        ticketRecordId,
        segmentOrder,
        fileName: body.fileName,
        mimeType: body.mimeType,
        filePath,
        uploadedBy: req.user!.id,
      },
    );

    const slotLabel = ticketSlotLabel({
      index: uploaded,
      passengerCount: loaded.application.passengers.length,
      tripType: loaded.application.tripType,
      passengers: loaded.application.passengers.map((p) => ({
        firstName: p.firstName,
        lastName: p.lastName,
      })),
    });

    await recordApplicationEvent(
      id,
      "ticket_uploaded",
      `Ticket uploaded (${segmentOrder} of ${required}): ${slotLabel} · ${body.passengerNames}.`,
    );

    const newUploadedCount = uploaded + 1;
    const allUploaded = newUploadedCount >= required;

    if (allUploaded) {
      await pool.execute(
        `UPDATE flight_applications SET status = 'completed', completed_at = UTC_TIMESTAMP() WHERE id = :id`,
        { id },
      );

      const auditSummary = `Application ${loaded.application.referenceNumber} completed.\nRoute: ${loaded.application.originCode}→${loaded.application.destinationCode}\nTickets uploaded: ${required}\nPassengers: ${loaded.application.passengers.length}\nTotal paid: MWK ${loaded.application.totalPriceMwk.toLocaleString()}`;

      await recordApplicationEvent(id, "completed", `All ${required} ticket(s) uploaded — application completed.`);

      const [allTicketFiles] = await pool.execute<RowDataPacket[]>(
        `SELECT file_name, mime_type, file_path, file_data FROM flight_application_tickets WHERE application_id = :id ORDER BY segment_order ASC`,
        { id },
      );

      const [users] = await pool.execute<RowDataPacket[]>(
        `SELECT first_name, last_name, email FROM users WHERE id = :uid`,
        { uid: loaded.raw.user_id },
      );
      const user = users[0];
      const ctx = emailContextFromRow(loaded.raw, `${user.first_name} ${user.last_name}`, user.email as string);

      const attachments = await Promise.all(
        allTicketFiles.map(async (f) => ({
          filename: f.file_name as string,
          content: await loadTicketFileContent(f),
          contentType: f.mime_type as string,
        })),
      );

      await emailApplicationCompleted({
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
  }),
);

adminApplicationsRouter.get(
  "/:id/tickets/:ticketId",
  asyncHandler(async (req, res) => {
    const applicationId = z.string().uuid().parse(req.params.id);
    const ticketId = z.string().uuid().parse(req.params.ticketId);

    const [tickets] = await pool.execute<RowDataPacket[]>(
      `SELECT file_name, mime_type, file_path, file_data FROM flight_application_tickets WHERE id = :id AND application_id = :applicationId`,
      { id: ticketId, applicationId },
    );
    const ticket = tickets[0];
    if (!ticket) throw new AppError(404, "Ticket not found");

    const content = await loadTicketFileContent(ticket);
    res.setHeader("Content-Type", ticket.mime_type as string);
    res.setHeader("Content-Disposition", `inline; filename="${ticket.file_name}"`);
    res.send(content);
  }),
);
