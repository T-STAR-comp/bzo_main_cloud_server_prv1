import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/errorHandler.js";
import { writeAuditLog } from "../services/audit.js";
import { loadTicketFileContent } from "../services/fileStorage.js";
import {
  emailApplicationCancelled,
  emailApplicationPaidAdmin,
  emailApplicationSubmitted,
} from "../services/applicationEmails.js";
import {
  emailContextFromRow,
  generateReferenceNumber,
  loadApplication,
  mapApplication,
  recordApplicationEvent,
} from "../services/applications.js";
import { expirePendingLedgersForOrder } from "../services/paymentLedger.js";
import {
  parseQuoteLineItems,
  quoteTotals,
  removeQuoteLineItem,
} from "../services/quoteLineItems.js";

export const applicationsRouter = Router();

applicationsRouter.use(authenticate);

const passengerSchema = z.object({
  passengerType: z.enum(["adult", "child", "infant"]),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ageYears: z.number().int().min(0).max(17).optional(),
  isAccompanied: z.boolean().optional(),
  infantSeatBooked: z.boolean().optional(),
});

const createSchema = z.object({
  originCode: z.string().length(3),
  originCity: z.string().min(1).max(100),
  destinationCode: z.string().length(3),
  destinationCity: z.string().min(1).max(100),
  tripType: z.enum(["oneway", "roundtrip"]).default("oneway"),
  departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departTimePreferred: z.string().min(1).max(20),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnTimePreferred: z.string().max(20).optional(),
  contactPhone: z.string().min(5).max(32),
  contactWhatsapp: z.string().max(32).optional(),
  cabinClass: z.string().default("Economy"),
  needCarRental: z.boolean().default(false),
  needHotel: z.boolean().default(false),
  hotelRequestDetails: z.string().max(2000).optional(),
  carRentalRequestDetails: z.string().max(2000).optional(),
  specialWheelchair: z.boolean().default(false),
  wheelchairReason: z.string().max(500).optional(),
  specialMeals: z.boolean().default(false),
  mealsReason: z.string().max(500).optional(),
  specialSeat: z.boolean().default(false),
  seatPreference: z.string().max(120).optional(),
  agentCode: z.string().max(32).optional(),
  passengers: z.array(passengerSchema).min(1).max(12),
});

applicationsRouter.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = createSchema.parse(req.body);
    const userId = req.user!.id;
    const id = uuid();
    const referenceNumber = generateReferenceNumber();
    const referralCode = body.agentCode?.trim().toUpperCase();
    let referredAgent: RowDataPacket | undefined;
    if (referralCode) {
      const [agentRows] = await pool.execute<RowDataPacket[]>(
        `SELECT id, agent_code, user_id FROM commission_agents WHERE agent_code = :agentCode AND status = 'active'`,
        { agentCode: referralCode },
      );
      if (agentRows[0]?.user_id !== userId) referredAgent = agentRows[0];
    }

    await pool.execute(
      `INSERT INTO flight_applications (
        id, user_id, agent_id, agent_code, reference_number, status,
        origin_code, origin_city, destination_code, destination_city,
        trip_type, depart_date, depart_time_preferred, return_date, return_time_preferred,
        contact_phone, contact_whatsapp, cabin_class,
        need_car_rental, need_hotel, hotel_request_details, car_rental_request_details,
        special_wheelchair, wheelchair_reason, special_meals, meals_reason,
        special_seat, seat_preference
      ) VALUES (
        :id, :userId, :agentId, :agentCode, :referenceNumber, 'pending',
        :originCode, :originCity, :destinationCode, :destinationCity,
        :tripType, :departDate, :departTimePreferred, :returnDate, :returnTimePreferred,
        :contactPhone, :contactWhatsapp, :cabinClass,
        :needCarRental, :needHotel, :hotelRequestDetails, :carRentalRequestDetails,
        :specialWheelchair, :wheelchairReason, :specialMeals, :mealsReason,
        :specialSeat, :seatPreference
      )`,
      {
        id,
        userId,
        agentId: referredAgent?.id ?? null,
        agentCode: referredAgent?.agent_code ?? null,
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
      },
    );

    for (let i = 0; i < body.passengers.length; i++) {
      const p = body.passengers[i];
      await pool.execute(
        `INSERT INTO flight_application_passengers (
          id, application_id, passenger_type, first_name, last_name,
          date_of_birth, age_years, is_accompanied, infant_seat_booked, sort_order
        ) VALUES (
          :id, :applicationId, :passengerType, :firstName, :lastName,
          :dateOfBirth, :ageYears, :isAccompanied, :infantSeatBooked, :sortOrder
        )`,
        {
          id: uuid(),
          applicationId: id,
          passengerType: p.passengerType,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth ?? null,
          ageYears: p.ageYears ?? null,
          isAccompanied: p.isAccompanied != null ? (p.isAccompanied ? 1 : 0) : null,
          infantSeatBooked: p.infantSeatBooked != null ? (p.infantSeatBooked ? 1 : 0) : null,
          sortOrder: i + 1,
        },
      );
    }

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: userId },
    );
    const user = users[0];

    await recordApplicationEvent(id, "submitted", "Customer submitted flight availability request.");

    const [appRow] = await pool.execute<RowDataPacket[]>(`SELECT * FROM flight_applications WHERE id = :id`, {
      id,
    });

    await emailApplicationSubmitted(
      emailContextFromRow(
        appRow[0],
        `${user.first_name} ${user.last_name}`,
        user.email as string,
      ),
    );

    await writeAuditLog({
      userId,
      action: "application.submitted",
      metadata: { applicationId: id, referenceNumber },
      ipAddress: req.ip ?? null,
    });

    const loaded = await loadApplication(id);
    res.status(201).json(loaded);
  }),
);

applicationsRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM flight_applications WHERE user_id = :userId ORDER BY created_at DESC`,
      { userId: req.user!.id },
    );

    const applications = await Promise.all(
      rows.map(async (row) => {
        const [passengers] = await pool.execute<RowDataPacket[]>(
          `SELECT * FROM flight_application_passengers WHERE application_id = :id ORDER BY sort_order`,
          { id: row.id },
        );
        return mapApplication(row, passengers);
      }),
    );

    res.json({ applications });
  }),
);

applicationsRouter.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const loaded = await loadApplication(id);
    if (!loaded || loaded.raw.user_id !== req.user!.id) {
      throw new AppError(404, "Application not found");
    }
    res.json(loaded);
  }),
);

applicationsRouter.get(
  "/:id/tickets/:ticketId",
  asyncHandler(async (req: AuthedRequest, res) => {
    const applicationId = z.string().uuid().parse(req.params.id);
    const ticketId = z.string().uuid().parse(req.params.ticketId);

    const [apps] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id FROM flight_applications WHERE id = :id`,
      { id: applicationId },
    );
    if (!apps[0] || apps[0].user_id !== req.user!.id) throw new AppError(404, "Not found");

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

applicationsRouter.post(
  "/:id/pay-demo",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const loaded = await loadApplication(id);
    if (!loaded || loaded.raw.user_id !== req.user!.id) throw new AppError(404, "Application not found");
    if (loaded.application.status !== "awaiting_payment") {
      throw new AppError(409, "Application is not awaiting payment");
    }

    await pool.execute(
      `UPDATE flight_applications SET status = 'paid', paid_at = UTC_TIMESTAMP() WHERE id = :id`,
      { id },
    );

    await recordApplicationEvent(id, "payment_demo", "Customer completed demo payment.");

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: req.user!.id },
    );
    const user = users[0];
    const ctx = emailContextFromRow(loaded.raw, `${user.first_name} ${user.last_name}`, user.email as string);

    await emailApplicationPaidAdmin({ ...ctx, totalMwk: loaded.application.totalPriceMwk });

    res.json({ message: "Demo payment recorded", status: "paid" });
  }),
);

applicationsRouter.patch(
  "/:id/quote-items",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ itemId: z.string().min(1) }).parse(req.body);

    const loaded = await loadApplication(id);
    if (!loaded || loaded.raw.user_id !== req.user!.id) {
      throw new AppError(404, "Application not found");
    }
    if (loaded.application.status !== "awaiting_payment") {
      throw new AppError(409, "Quote can only be adjusted while awaiting payment");
    }

    const items = parseQuoteLineItems(loaded.raw.quote_line_items);
    if (items.length === 0) {
      throw new AppError(400, "This quote does not support item removal");
    }

    const target = items.find((i) => i.id === body.itemId);
    if (!target) throw new AppError(404, "Quote item not found");
    if (!target.removable) throw new AppError(400, "This charge cannot be removed");
    if (target.removed) throw new AppError(409, "This charge was already removed");

    const updatedItems = removeQuoteLineItem(items, body.itemId);
    const totals = quoteTotals(updatedItems);

    await pool.execute(
      `UPDATE flight_applications SET
        extra_charges_mwk = :extraChargesMwk,
        quote_line_items = :quoteLineItems
       WHERE id = :id`,
      {
        id,
        extraChargesMwk: totals.extrasMwk,
        quoteLineItems: JSON.stringify(updatedItems),
      },
    );

    await expirePendingLedgersForOrder("flight_application", id);
    await recordApplicationEvent(
      id,
      "quote_item_removed",
      `Customer removed optional charge: ${target.label}.`,
    );

    const refreshed = await loadApplication(id);
    res.json({ application: refreshed!.application });
  }),
);

applicationsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const loaded = await loadApplication(id);
    if (!loaded || loaded.raw.user_id !== req.user!.id) throw new AppError(404, "Application not found");

    if (!["pending", "in_review", "awaiting_payment"].includes(loaded.application.status)) {
      throw new AppError(409, "Application cannot be cancelled at this stage");
    }

    await pool.execute(`UPDATE flight_applications SET status = 'cancelled' WHERE id = :id`, { id });
    await recordApplicationEvent(id, "cancelled", "Customer cancelled the application.");

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: req.user!.id },
    );
    const user = users[0];
    await emailApplicationCancelled(
      emailContextFromRow(loaded.raw, `${user.first_name} ${user.last_name}`, user.email as string),
    );

    res.json({ message: "Application cancelled" });
  }),
);
