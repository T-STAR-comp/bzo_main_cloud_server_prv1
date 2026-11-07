import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/errorHandler.js";
import { buildAgentReferralLink } from "../services/agentReferralLink.js";
import { writeAuditLog, publicUser, type UserRow } from "../services/audit.js";
import { searchTravelCreditRecipients, shareTravelCredit } from "../services/travelCredits.js";
import { ticketDisplayStatus } from "../services/ticketUtils.js";

export const accountRouter = Router();

accountRouter.use(authenticate);

accountRouter.get(
  "/me",
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;

    const [users] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE id = :id`, { id: userId });
    const user = users[0];
    if (!user) throw new AppError(404, "User not found");

    let agentProfile = null;
    if (user.role === "agent") {
      const [agentRows] = await pool.execute<RowDataPacket[]>(`
        SELECT ca.*, 
          COALESCE((SELECT SUM(sale_amount_mwk) FROM commission_agent_records WHERE agent_id = ca.id), 0) AS total_sales_mwk,
          COALESCE((SELECT SUM(commission_amount_mwk) FROM commission_agent_records WHERE agent_id = ca.id), 0) AS total_commission_mwk,
          COALESCE((SELECT SUM(amount_mwk) FROM commission_agent_redemptions WHERE agent_id = ca.id), 0) AS redeemed_mwk
        FROM commission_agents ca
        WHERE ca.user_id = :userId
      `, { userId });
      agentProfile = agentRows[0] ?? null;
    }

    const [prefs] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_preferences WHERE user_id = :userId`,
      { userId },
    );
    const [credit] = await pool.execute<RowDataPacket[]>(
      `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`,
      { userId },
    );
    const [bookings] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM bookings WHERE user_id = :userId ORDER BY depart_at DESC`,
      { userId },
    );
    const [tickets] = await pool.execute<RowDataPacket[]>(
      `SELECT t.*, b.pnr,
        fa.id AS application_id,
        fat.id AS app_ticket_id
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN flight_application_tickets fat ON fat.ticket_record_id = t.id
       LEFT JOIN flight_applications fa ON fa.booking_id = t.booking_id
       WHERE t.user_id = :userId ORDER BY t.depart_at DESC`,
      { userId },
    );

    res.json({
      user: publicUser(user),
      preferences: mapPreferences(prefs[0]),
      travelCreditMwk: credit[0]?.balance_mwk ?? 0,
      bookings: bookings.map(mapBooking),
      tickets: tickets.map(mapTicket),
      agentProfile,
    });
  }),
);

async function loadAgentSummary(userId: string) {
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT ca.*, u.first_name, u.last_name, u.email, u.phone,
      COALESCE((SELECT SUM(sale_amount_mwk) FROM commission_agent_records WHERE agent_id = ca.id), 0) AS total_sales_mwk,
      COALESCE((SELECT SUM(commission_amount_mwk) FROM commission_agent_records WHERE agent_id = ca.id), 0) AS total_commission_mwk,
      COALESCE((SELECT SUM(amount_mwk) FROM commission_agent_redemptions WHERE agent_id = ca.id), 0) AS redeemed_mwk
     FROM commission_agents ca
     JOIN users u ON u.id = ca.user_id
     WHERE ca.user_id = :userId`,
    { userId },
  );

  const agent = agentRows[0];
  if (!agent) throw new AppError(404, "Agent profile not found");

  const [records] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM commission_agent_records WHERE agent_id = :agentId ORDER BY sale_date DESC, created_at DESC LIMIT 60`,
    { agentId: agent.id },
  );

  const [redemptions] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM commission_agent_redemptions WHERE agent_id = :agentId ORDER BY created_at DESC LIMIT 50`,
    { agentId: agent.id },
  );

  const [months] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(sale_date, '%Y-%m') AS month_key,
            COALESCE(SUM(sale_amount_mwk), 0) AS sales_mwk,
            COALESCE(SUM(commission_amount_mwk), 0) AS commission_mwk
     FROM commission_agent_records
     WHERE agent_id = :agentId
     GROUP BY month_key
     ORDER BY month_key DESC
     LIMIT 12`,
    { agentId: agent.id },
  );

  const gross = Number(agent.total_commission_mwk ?? 0);
  const redeemed = Number(agent.redeemed_mwk ?? 0);
  return {
    agent: {
      id: agent.id,
      userId: agent.user_id,
      fullName: agent.full_name,
      email: agent.email,
      phone: agent.phone,
      percentage: Number(agent.commission_percentage),
      status: agent.status,
      agentCode: agent.agent_code,
      referralLink: buildAgentReferralLink(String(agent.agent_code)),
      commissionTotalMwk: gross,
      redeemedMwk: redeemed,
      payableBalanceMwk: Math.max(gross - redeemed, 0),
      createdAt: new Date(agent.created_at as string).toISOString(),
      updatedAt: new Date(agent.updated_at as string).toISOString(),
    },
    monthlyBreakdown: months.map((row) => ({
      month: String(row.month_key),
      salesMwk: Number(row.sales_mwk ?? 0),
      commissionMwk: Number(row.commission_mwk ?? 0),
    })),
    records: records.map((row) => ({
      id: row.id,
      saleDate: new Date(row.sale_date as string).toISOString(),
      amountMwk: Number(row.sale_amount_mwk ?? 0),
      commissionAmountMwk: Number(row.commission_amount_mwk ?? 0),
      source: row.source,
      note: row.note ?? null,
    })),
    redemptions: redemptions.map((row) => ({
      id: row.id,
      amountMwk: Number(row.amount_mwk ?? 0),
      note: row.note ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
    })),
  };
}

accountRouter.get(
  "/agent/summary",
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.user!.role !== "agent") {
      throw new AppError(403, "Agent access required");
    }

    const summary = await loadAgentSummary(req.user!.id);
    res.json(summary);
  }),
);

accountRouter.post(
  "/agent/regenerate-link",
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.user!.role !== "agent") {
      throw new AppError(403, "Agent access required");
    }

    const code = `AG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const link = buildAgentReferralLink(code);

    await pool.execute(
      `UPDATE commission_agents SET agent_code = :code, referral_link = :link, updated_at = UTC_TIMESTAMP() WHERE user_id = :userId`,
      { code, link, userId: req.user!.id },
    );

    res.json({ code, link, message: "Agent referral link regenerated." });
  }),
);

accountRouter.patch(
  "/agent/profile",
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.user!.role !== "agent") {
      throw new AppError(403, "Agent access required");
    }

    const schema = z.object({
      firstName: z.string().min(1).max(100).optional(),
      lastName: z.string().min(1).max(100).optional(),
      phone: z.string().max(32).nullable().optional(),
      fullName: z.string().min(1).max(150).optional(),
      notes: z.string().max(2000).nullable().optional(),
    });

    const body = schema.parse(req.body);
    const updates: string[] = [];
    const params: Record<string, string | number | null> = { userId: req.user!.id };

    if (body.firstName !== undefined) {
      updates.push("first_name = :firstName");
      params.firstName = body.firstName;
    }
    if (body.lastName !== undefined) {
      updates.push("last_name = :lastName");
      params.lastName = body.lastName;
    }
    if (body.phone !== undefined) {
      updates.push("phone = :phone");
      params.phone = body.phone;
    }

    if (updates.length > 0) {
      await pool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = :userId`, params);
    }

    const agentUpdates: string[] = [];
    const agentParams: Record<string, string | number | null> = { userId: req.user!.id };
    if (body.fullName !== undefined) {
      agentUpdates.push("full_name = :fullName");
      agentParams.fullName = body.fullName;
    }
    if (body.phone !== undefined) {
      agentUpdates.push("phone = :phone");
      agentParams.phone = body.phone;
    }
    if (body.notes !== undefined) {
      agentUpdates.push("notes = :notes");
      agentParams.notes = body.notes;
    }

    if (agentUpdates.length > 0) {
      await pool.execute(
        `UPDATE commission_agents SET ${agentUpdates.join(", ")} WHERE user_id = :userId`,
        agentParams,
      );
    }

    const summary = await loadAgentSummary(req.user!.id);
    res.json({ message: "Agent profile updated.", agent: summary.agent });
  }),
);

const profileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(32).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nationality: z.string().max(100).nullable().optional(),
});

accountRouter.patch(
  "/profile",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = profileSchema.parse(req.body);
    const userId = req.user!.id;

    const fields: string[] = [];
    const params: Record<string, string | number | null> = { userId };

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

    if (fields.length === 0) throw new AppError(400, "No fields to update");

    await pool.execute(`UPDATE users SET ${fields.join(", ")} WHERE id = :userId`, params);

    const [users] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE id = :id`, { id: userId });

    await writeAuditLog({
      userId,
      action: "account.profile_updated",
      metadata: body,
      ipAddress: req.ip ?? null,
    });

    res.json({ user: publicUser(users[0]) });
  }),
);

const preferencesSchema = z.object({
  cabinClass: z.string().max(50).optional(),
  seatPreference: z.string().max(50).optional(),
  meal: z.string().max(50).optional(),
  frequentFlyer: z.string().max(120).nullable().optional(),
  directFlightsOnly: z.boolean().optional(),
  avoidRedEyes: z.boolean().optional(),
  offsetCarbon: z.boolean().optional(),
  accountCurrency: z.string().length(3).nullable().optional(),
  language: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
  notifyFlightStatus: z.boolean().optional(),
  notifyGateDelay: z.boolean().optional(),
  notifyFareDrops: z.boolean().optional(),
  notifyJournal: z.boolean().optional(),
  notifyProductNews: z.boolean().optional(),
});

accountRouter.patch(
  "/preferences",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = preferencesSchema.parse(req.body);
    const userId = req.user!.id;

    const map: Record<string, string> = {
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

    const fields: string[] = [];
    const params: Record<string, string | number | null> = { userId };

    for (const [key, column] of Object.entries(map)) {
      const val = body[key as keyof typeof body];
      if (val !== undefined) {
        fields.push(`${column} = :${key}`);
        params[key] = typeof val === "boolean" ? (val ? 1 : 0) : val;
      }
    }

    if (fields.length === 0) throw new AppError(400, "No preferences to update");

    await pool.execute(`UPDATE user_preferences SET ${fields.join(", ")} WHERE user_id = :userId`, params);

    const [prefs] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_preferences WHERE user_id = :userId`,
      { userId },
    );

    await writeAuditLog({
      userId,
      action: "account.preferences_updated",
      ipAddress: req.ip ?? null,
    });

    res.json({ preferences: mapPreferences(prefs[0]) });
  }),
);

accountRouter.get(
  "/travel-credits/recipients",
  asyncHandler(async (req: AuthedRequest, res) => {
    const q = z.string().min(3).max(120).parse(req.query.q);
    const recipients = await searchTravelCreditRecipients(req.user!.id, q);
    res.json({ recipients });
  }),
);

const shareTravelCreditSchema = z.object({
  recipientUserId: z.string().uuid(),
  amountMwk: z.number().positive(),
  note: z.string().max(200).optional(),
});

accountRouter.post(
  "/travel-credits/share",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = shareTravelCreditSchema.parse(req.body);
    const result = await shareTravelCredit({
      fromUserId: req.user!.id,
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
  }),
);

function mapPreferences(row?: RowDataPacket) {
  if (!row) return null;
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

function mapBooking(row: RowDataPacket) {
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
    departAt: new Date(row.depart_at as string).toISOString(),
    arriveAt: new Date(row.arrive_at as string).toISOString(),
    cabinClass: row.cabin_class,
    priceMwk: Number(row.price_mwk),
  };
}

function mapTicket(row: RowDataPacket) {
  const applicationId = row.application_id as string | null;
  const appTicketId = row.app_ticket_id as string | null;
  const departAt = new Date(row.depart_at as string).toISOString();
  const dbStatus = row.status as string;
  const displayStatus = ticketDisplayStatus(departAt, dbStatus);
  return {
    id: row.id,
    bookingId: row.booking_id,
    pnr: row.pnr as string,
    originCode: row.origin_code,
    destinationCode: row.destination_code,
    originCity: row.origin_city,
    destinationCity: row.destination_city,
    departAt,
    arriveAt: new Date(row.arrive_at as string).toISOString(),
    airline: row.airline,
    flightLabel: row.flight_label,
    seat: row.seat,
    gate: row.gate,
    class: row.class,
    status: dbStatus,
    displayStatus,
    isInactive: displayStatus === "inactive",
    passengerNames: (row.passenger_names as string | null) ?? null,
    applicationId,
    documentUrl:
      applicationId && appTicketId
        ? `/applications/${applicationId}/tickets/${appTicketId}`
        : null,
  };
}
