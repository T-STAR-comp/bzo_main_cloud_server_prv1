"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const paymentLedger_js_1 = require("../services/paymentLedger.js");
const financialReports_js_1 = require("../services/financialReports.js");
const platformSettings_js_1 = require("../services/platformSettings.js");
const audit_js_1 = require("../services/audit.js");
const applicationEmails_js_1 = require("../services/applicationEmails.js");
const applications_js_1 = require("../services/applications.js");
const ticketUtils_js_1 = require("../services/ticketUtils.js");
const fileStorage_js_1 = require("../services/fileStorage.js");
const manualPaymentSources_js_1 = require("../services/manualPaymentSources.js");
const manualPayments_js_1 = require("../services/manualPayments.js");
const travelCredits_js_1 = require("../services/travelCredits.js");
const crypto_js_1 = require("../utils/crypto.js");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_js_1.authenticate, auth_js_1.requireAdmin);
function parseDateRange(query) {
    const fromRaw = zod_1.z.string().optional().parse(query.from);
    const toRaw = zod_1.z.string().optional().parse(query.to);
    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;
    if (fromRaw && Number.isNaN(from.getTime()))
        throw new errorHandler_js_1.AppError(400, "Invalid from date");
    if (toRaw && Number.isNaN(to.getTime()))
        throw new errorHandler_js_1.AppError(400, "Invalid to date");
    return { from, to };
}
function dateFilterSql(column, from, to, params) {
    let sql = "";
    if (from) {
        sql += ` AND ${column} >= :dateFrom`;
        params.dateFrom = from.toISOString().slice(0, 19).replace("T", " ");
    }
    if (to) {
        sql += ` AND ${column} < :dateTo`;
        params.dateTo = to.toISOString().slice(0, 19).replace("T", " ");
    }
    return sql;
}
function mapLedgerAdminDetail(row) {
    const base = (0, paymentLedger_js_1.mapLedgerPublic)(row);
    const providerRaw = typeof row.provider_response === "string"
        ? JSON.parse(row.provider_response)
        : row.provider_response;
    return {
        ...base,
        userId: row.user_id,
        userEmail: row.email,
        userName: row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
        userPhone: row.phone ?? null,
        paychanguRefId: row.paychangu_ref_id,
        providerResponse: providerRaw,
        mobileOperatorRefId: row.mobile_operator_ref_id,
        orderFulfilledAt: row.order_fulfilled_at ? new Date(row.order_fulfilled_at).toISOString() : null,
        lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
        verificationAttempts: Number(row.verification_attempts ?? 0),
        failureReason: row.failure_reason,
        manualReference: row.manual_reference,
        proofReviewStatus: row.proof_review_status ?? "none",
        proofSubmittedAt: row.proof_submitted_at ? new Date(row.proof_submitted_at).toISOString() : null,
        proofRejectionReason: row.proof_rejection_reason,
        hasProof: Boolean(row.proof_file_path),
    };
}
function formatUserSummary(row) {
    return {
        id: row.id,
        email: row.email,
        username: row.username,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        role: row.role,
        status: row.status,
        emailVerified: Boolean(row.email_verified_at),
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        bookingCount: Number(row.booking_count ?? 0),
        openIssues: Number(row.open_issues ?? 0),
        creditBalance: Number(row.credit_balance ?? 0),
    };
}
exports.adminRouter.get("/stats", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const [[users]] = await pool_js_1.pool.execute(`SELECT
        COUNT(*) AS total,
        SUM(role = 'admin') AS admins,
        SUM(status = 'active') AS active,
        SUM(status = 'flagged') AS flagged
       FROM users`);
    const [[bookings]] = await pool_js_1.pool.execute(`SELECT COUNT(*) AS total, SUM(status = 'confirmed') AS confirmed FROM bookings`);
    const [[routes]] = await pool_js_1.pool.execute(`SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM flight_routes`);
    const [[finance]] = await pool_js_1.pool.execute(`SELECT COALESCE(SUM(CASE WHEN entry_type IN ('payment','fee') THEN amount_mwk ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN amount_mwk ELSE 0 END), 0) AS refunds
       FROM finance_ledger`);
    const [[tickets]] = await pool_js_1.pool.execute(`SELECT COUNT(*) AS total FROM tickets`);
    res.json({
        users: {
            total: Number(users.total),
            admins: Number(users.admins),
            active: Number(users.active),
            flagged: Number(users.flagged),
        },
        bookings: { total: Number(bookings.total), confirmed: Number(bookings.confirmed) },
        routes: { total: Number(routes.total), active: Number(routes.active) },
        finance: { revenueMwk: Number(finance.revenue), refundsMwk: Number(finance.refunds) },
        tickets: { total: Number(tickets.total) },
    });
}));
exports.adminRouter.get("/users", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const q = zod_1.z.string().optional().parse(req.query.q);
    const status = zod_1.z.enum(["active", "suspended", "pending", "flagged"]).optional().parse(req.query.status);
    let sql = `
      SELECT u.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) AS booking_count,
        (SELECT COUNT(*) FROM user_account_issues i WHERE i.user_id = u.id AND i.resolved_at IS NULL) AS open_issues,
        COALESCE((SELECT balance_mwk FROM travel_credit tc WHERE tc.user_id = u.id), 0) AS credit_balance
      FROM users u WHERE 1=1`;
    const params = {};
    if (q) {
        sql += ` AND (u.email LIKE :q OR u.first_name LIKE :q OR u.last_name LIKE :q OR u.username LIKE :q)`;
        params.q = `%${q}%`;
    }
    if (status) {
        sql += ` AND u.status = :status`;
        params.status = status;
    }
    sql += ` ORDER BY u.created_at DESC LIMIT 200`;
    const [rows] = await pool_js_1.pool.execute(sql, params);
    res.json({ users: rows.map(formatUserSummary) });
}));
exports.adminRouter.get("/users/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const userId = zod_1.z.string().uuid().parse(req.params.id);
    const [users] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, { id: userId });
    const user = users[0];
    if (!user)
        throw new errorHandler_js_1.AppError(404, "User not found");
    const [bookings] = await pool_js_1.pool.execute(`SELECT * FROM bookings WHERE user_id = :userId ORDER BY created_at DESC LIMIT 50`, { userId });
    const [issues] = await pool_js_1.pool.execute(`SELECT * FROM user_account_issues WHERE user_id = :userId ORDER BY created_at DESC`, { userId });
    const [ledger] = await pool_js_1.pool.execute(`SELECT * FROM finance_ledger WHERE user_id = :userId ORDER BY created_at DESC LIMIT 50`, { userId });
    const [creditRows] = await pool_js_1.pool.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`, { userId });
    const [audit] = await pool_js_1.pool.execute(`SELECT action, level, metadata, created_at FROM audit_logs WHERE user_id = :userId ORDER BY created_at DESC LIMIT 30`, { userId });
    const [tickets] = await pool_js_1.pool.execute(`SELECT t.*, b.pnr FROM tickets t JOIN bookings b ON b.id = t.booking_id
       WHERE t.user_id = :userId ORDER BY t.depart_at DESC LIMIT 20`, { userId });
    res.json({
        user: {
            ...formatUserSummary(user),
            dateOfBirth: user.date_of_birth ? user.date_of_birth.toISOString().slice(0, 10) : null,
            nationality: user.nationality,
            adminNotes: user.admin_notes,
        },
        bookings: bookings.map(mapBooking),
        issues: issues.map(mapIssue),
        finance: ledger.map(mapLedger),
        creditBalance: Number(creditRows[0]?.balance_mwk ?? 0),
        audit: audit.map((a) => ({
            action: a.action,
            level: a.level,
            metadata: a.metadata,
            createdAt: new Date(a.created_at).toISOString(),
        })),
        tickets: tickets.map(mapAdminTicket),
    });
}));
const updateUserSchema = zod_1.z.object({
    status: zod_1.z.enum(["active", "suspended", "pending", "flagged"]).optional(),
    adminNotes: zod_1.z.string().max(5000).optional(),
    role: zod_1.z.enum(["user", "admin"]).optional(),
});
exports.adminRouter.patch("/users/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const userId = zod_1.z.string().uuid().parse(req.params.id);
    const body = updateUserSchema.parse(req.body);
    const updates = [];
    const params = { id: userId };
    if (body.status) {
        updates.push("status = :status");
        params.status = body.status;
    }
    if (body.adminNotes !== undefined) {
        updates.push("admin_notes = :adminNotes");
        params.adminNotes = body.adminNotes;
    }
    if (body.role) {
        updates.push("role = :role");
        params.role = body.role;
    }
    if (updates.length === 0)
        throw new errorHandler_js_1.AppError(400, "No updates provided");
    await pool_js_1.pool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = :id`, params);
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.user_updated",
        metadata: { targetUserId: userId, ...body },
        ipAddress: req.ip ?? null,
    });
    res.json({ message: "User updated" });
}));
const createUserSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    firstName: zod_1.z.string().min(1).max(100),
    lastName: zod_1.z.string().min(1).max(100),
    role: zod_1.z.enum(["user", "admin"]).default("user"),
    phone: zod_1.z.string().max(32).optional(),
    username: zod_1.z.string().min(3).max(50).optional(),
});
exports.adminRouter.post("/users", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const [existing] = await pool_js_1.pool.execute(`SELECT id FROM users WHERE email = :email`, { email });
    if (existing[0])
        throw new errorHandler_js_1.AppError(409, "Email already registered");
    const userId = (0, uuid_1.v4)();
    const passwordHash = await (0, crypto_js_1.hashPassword)(body.password);
    await pool_js_1.pool.execute(`INSERT INTO users (id, email, username, password_hash, email_verified_at, first_name, last_name, phone, role, status)
       VALUES (:id, :email, :username, :passwordHash, UTC_TIMESTAMP(), :firstName, :lastName, :phone, :role, 'active')`, {
        id: userId,
        email,
        username: body.username ?? null,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        role: body.role,
    });
    await pool_js_1.pool.execute(`INSERT INTO user_preferences (user_id) VALUES (:userId)`, { userId });
    await pool_js_1.pool.execute(`INSERT INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, { userId });
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.user_created",
        metadata: { targetUserId: userId, role: body.role },
        ipAddress: req.ip ?? null,
    });
    res.status(201).json({ id: userId, message: "Account created" });
}));
const issueSchema = zod_1.z.object({
    severity: zod_1.z.enum(["low", "medium", "high", "critical"]).default("medium"),
    title: zod_1.z.string().min(1).max(200),
    description: zod_1.z.string().max(2000).optional(),
});
exports.adminRouter.post("/users/:id/issues", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const userId = zod_1.z.string().uuid().parse(req.params.id);
    const body = issueSchema.parse(req.body);
    const id = (0, uuid_1.v4)();
    await pool_js_1.pool.execute(`INSERT INTO user_account_issues (id, user_id, severity, title, description)
       VALUES (:id, :userId, :severity, :title, :description)`, { id, userId, severity: body.severity, title: body.title, description: body.description ?? null });
    await pool_js_1.pool.execute(`UPDATE users SET status = 'flagged' WHERE id = :id AND status = 'active'`, { id: userId });
    res.status(201).json({ id, message: "Issue recorded" });
}));
exports.adminRouter.patch("/users/:id/issues/:issueId/resolve", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const userId = zod_1.z.string().uuid().parse(req.params.id);
    const issueId = zod_1.z.string().uuid().parse(req.params.issueId);
    await pool_js_1.pool.execute(`UPDATE user_account_issues SET resolved_at = UTC_TIMESTAMP() WHERE id = :issueId AND user_id = :userId`, { issueId, userId });
    res.json({ message: "Issue resolved" });
}));
exports.adminRouter.get("/payments", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const { from, to } = parseDateRange(req.query);
    const params = {};
    let sql = `
      SELECT pl.*, u.email, u.first_name, u.last_name
      FROM payment_ledger pl
      JOIN users u ON u.id = pl.user_id
      WHERE 1=1`;
    sql += dateFilterSql("pl.created_at", from, to, params);
    sql += ` ORDER BY pl.created_at DESC LIMIT 200`;
    const [rows] = await pool_js_1.pool.execute(sql, params);
    res.json({
        entries: rows.map((row) => ({
            ...(0, paymentLedger_js_1.mapLedgerPublic)(row),
            userEmail: row.email,
            userName: `${row.first_name} ${row.last_name}`,
        })),
    });
}));
exports.adminRouter.get("/payments/ledger/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const [rows] = await pool_js_1.pool.execute(`SELECT pl.*, u.email, u.first_name, u.last_name, u.phone
       FROM payment_ledger pl
       JOIN users u ON u.id = pl.user_id
       WHERE pl.id = :id`, { id });
    const row = rows[0];
    if (!row)
        throw new errorHandler_js_1.AppError(404, "Payment not found");
    const [financeEntries] = await pool_js_1.pool.execute(`SELECT * FROM finance_ledger WHERE reference = :chargeId OR reference = :id ORDER BY created_at ASC`, { chargeId: row.charge_id, id });
    const [creditTx] = await pool_js_1.pool.execute(`SELECT * FROM travel_credit_transactions WHERE payment_ledger_id = :id`, { id });
    res.json({
        payment: mapLedgerAdminDetail(row),
        financeEntries: financeEntries.map(mapLedger),
        travelCreditTransactions: creditTx.map((t) => ({
            id: t.id,
            entryType: t.entry_type,
            amountMwk: Number(t.amount_mwk),
            balanceAfter: Number(t.balance_after),
            description: t.description,
            createdAt: new Date(t.created_at).toISOString(),
        })),
    });
}));
exports.adminRouter.get("/payments/ledger", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const { from, to } = parseDateRange(req.query);
    const params = {};
    let sql = `
      SELECT pl.*, u.email, u.first_name, u.last_name
      FROM payment_ledger pl
      JOIN users u ON u.id = pl.user_id
      WHERE 1=1`;
    sql += dateFilterSql("pl.created_at", from, to, params);
    sql += ` ORDER BY pl.created_at DESC LIMIT 200`;
    const [rows] = await pool_js_1.pool.execute(sql, params);
    res.json({
        entries: rows.map((row) => ({
            ...(0, paymentLedger_js_1.mapLedgerPublic)(row),
            userEmail: row.email,
            userName: `${row.first_name} ${row.last_name}`,
        })),
    });
}));
exports.adminRouter.get("/payments/ledger/:id/proof", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const [rows] = await pool_js_1.pool.execute(`SELECT proof_file_path, proof_mime_type FROM payment_ledger WHERE id = :id`, { id });
    const row = rows[0];
    if (!row?.proof_file_path)
        throw new errorHandler_js_1.AppError(404, "Proof not found");
    const buffer = await (0, fileStorage_js_1.readStoredFile)(row.proof_file_path);
    const mime = row.proof_mime_type ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `inline; filename="payment-proof-${id}"`);
    res.send(buffer);
}));
exports.adminRouter.post("/payments/ledger/:id/approve-proof", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const row = await (0, manualPayments_js_1.approveManualPaymentProof)(id, req.user.id);
    res.json({ payment: mapLedgerAdminDetail(row), message: "Payment approved" });
}));
exports.adminRouter.post("/payments/ledger/:id/reject-proof", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const body = zod_1.z.object({ reason: zod_1.z.string().min(3).max(500) }).parse(req.body);
    const row = await (0, manualPayments_js_1.rejectManualPaymentProof)(id, req.user.id, body.reason);
    res.json({ payment: mapLedgerAdminDetail(row), message: "Proof rejected" });
}));
exports.adminRouter.get("/payment-sources", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const sources = await (0, manualPaymentSources_js_1.listManualPaymentSources)(false);
    res.json({ sources });
}));
const paymentSourceSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(120),
    bankName: zod_1.z.string().min(1).max(120),
    accountName: zod_1.z.string().min(1).max(200),
    accountNumber: zod_1.z.string().min(1).max(80),
    branchCode: zod_1.z.string().max(80).optional().nullable(),
    swiftCode: zod_1.z.string().max(40).optional().nullable(),
    currency: zod_1.z.string().length(3).default("MWK"),
    instructions: zod_1.z.string().max(2000).optional().nullable(),
    sortOrder: zod_1.z.number().int().min(0).max(9999).optional(),
    isActive: zod_1.z.boolean().optional(),
});
exports.adminRouter.post("/payment-sources", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = paymentSourceSchema.parse(req.body);
    const source = await (0, manualPaymentSources_js_1.createManualPaymentSource)(body);
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "payment_source.created",
        metadata: { sourceId: source.id, label: source.label },
    });
    res.status(201).json({ source });
}));
exports.adminRouter.patch("/payment-sources/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const body = paymentSourceSchema.partial().parse(req.body);
    const source = await (0, manualPaymentSources_js_1.updateManualPaymentSource)(id, body);
    if (!source)
        throw new errorHandler_js_1.AppError(404, "Payment source not found");
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "payment_source.updated",
        metadata: { sourceId: id },
    });
    res.json({ source });
}));
exports.adminRouter.delete("/payment-sources/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    await (0, manualPaymentSources_js_1.deleteManualPaymentSource)(id);
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "payment_source.deleted",
        metadata: { sourceId: id },
    });
    res.json({ message: "Payment source removed" });
}));
exports.adminRouter.get("/finance", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const { from, to } = parseDateRange(req.query);
    const params = {};
    let entrySql = `
      SELECT fl.*, u.email, u.first_name, u.last_name
      FROM finance_ledger fl
      LEFT JOIN users u ON u.id = fl.user_id
      WHERE 1=1`;
    entrySql += dateFilterSql("fl.created_at", from, to, params);
    entrySql += ` ORDER BY fl.created_at DESC LIMIT 500`;
    const [entries] = await pool_js_1.pool.execute(entrySql, params);
    let totalsSql = `
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN amount_mwk ELSE 0 END), 0) AS payments,
        COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN amount_mwk ELSE 0 END), 0) AS refunds,
        COALESCE(SUM(CASE WHEN entry_type = 'fee' THEN amount_mwk ELSE 0 END), 0) AS fees,
        COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_mwk ELSE 0 END), 0) AS credits
      FROM finance_ledger WHERE 1=1`;
    totalsSql += dateFilterSql("created_at", from, to, params);
    const [[totals]] = await pool_js_1.pool.execute(totalsSql, params);
    res.json({
        totals: {
            paymentsMwk: Number(totals.payments),
            refundsMwk: Number(totals.refunds),
            feesMwk: Number(totals.fees),
            creditsMwk: Number(totals.credits),
            grossRevenueMwk: Number(totals.payments) + Number(totals.fees),
            netRevenueMwk: Number(totals.payments) + Number(totals.fees) - Number(totals.refunds),
        },
        entries: entries.map((e) => ({
            ...mapLedger(e),
            userEmail: e.email,
            userName: e.first_name ? `${e.first_name} ${e.last_name}` : null,
        })),
    });
}));
const financeEntrySchema = zod_1.z.object({
    userId: zod_1.z.string().uuid().optional(),
    bookingId: zod_1.z.string().uuid().optional(),
    entryType: zod_1.z.enum(["payment", "refund", "credit", "fee", "payout", "adjustment"]),
    amountMwk: zod_1.z.number().positive(),
    description: zod_1.z.string().min(1).max(255),
    reference: zod_1.z.string().max(100).optional(),
});
exports.adminRouter.post("/finance", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = financeEntrySchema.parse(req.body);
    const id = (0, uuid_1.v4)();
    await pool_js_1.pool.execute(`INSERT INTO finance_ledger (id, user_id, booking_id, entry_type, amount_mwk, description, reference, created_by)
       VALUES (:id, :userId, :bookingId, :entryType, :amountMwk, :description, :reference, :createdBy)`, {
        id,
        userId: body.userId ?? null,
        bookingId: body.bookingId ?? null,
        entryType: body.entryType,
        amountMwk: body.amountMwk,
        description: body.description,
        reference: body.reference ?? null,
        createdBy: req.user.id,
    });
    if (body.entryType === "credit" && body.userId) {
        await pool_js_1.pool.execute(`UPDATE travel_credit SET balance_mwk = balance_mwk + :amount WHERE user_id = :userId`, { amount: body.amountMwk, userId: body.userId });
    }
    res.status(201).json({ id, message: "Finance entry recorded" });
}));
const financeReportSchema = zod_1.z.object({
    from: zod_1.z.string(),
    to: zod_1.z.string(),
    recipientEmail: zod_1.z.string().email().optional(),
});
exports.adminRouter.post("/finance/report", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = financeReportSchema.parse(req.body);
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new errorHandler_js_1.AppError(400, "Invalid date range");
    }
    const label = `Manual (${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)})`;
    const result = await (0, financialReports_js_1.sendFinancialReport)(from, to, label, "manual", body.recipientEmail, req.user.id);
    res.json({ message: "Financial report sent", sentTo: result.sentTo, reportId: result.reportId });
}));
exports.adminRouter.get("/settings", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const settings = await (0, platformSettings_js_1.getPlatformSettings)();
    res.json({ settings });
}));
const platformSettingsSchema = zod_1.z.object({
    whatsappNumber: zod_1.z.string().min(8).max(32).optional(),
    conciergePhone: zod_1.z.string().min(8).max(32).optional(),
    reportEmail: zod_1.z.string().email().optional(),
    reportSchedules: zod_1.z
        .object({
        weekly: zod_1.z.boolean(),
        monthly: zod_1.z.boolean(),
        quarterly: zod_1.z.boolean(),
        biannual: zod_1.z.boolean(),
        yearly: zod_1.z.boolean(),
    })
        .optional(),
});
exports.adminRouter.patch("/settings", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = platformSettingsSchema.parse(req.body);
    const settings = await (0, platformSettings_js_1.updatePlatformSettings)(body, req.user.id);
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.settings_updated",
        metadata: body,
        ipAddress: req.ip ?? null,
    });
    res.json({ settings, message: "Platform settings updated" });
}));
exports.adminRouter.get("/me", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const [users] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
    const user = users[0];
    if (!user)
        throw new errorHandler_js_1.AppError(404, "User not found");
    res.json({ user: (0, audit_js_1.publicUser)(user, true) });
}));
const updateAdminProfileSchema = zod_1.z.object({
    email: zod_1.z.string().email().optional(),
    firstName: zod_1.z.string().min(1).max(100).optional(),
    lastName: zod_1.z.string().min(1).max(100).optional(),
    phone: zod_1.z.string().max(32).optional().nullable(),
    currentPassword: zod_1.z.string().min(1).optional(),
    newPassword: zod_1.z.string().min(8).optional(),
});
exports.adminRouter.patch("/me", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = updateAdminProfileSchema.parse(req.body);
    const [users] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
    const user = users[0];
    if (!user)
        throw new errorHandler_js_1.AppError(404, "User not found");
    if (body.newPassword) {
        if (!body.currentPassword)
            throw new errorHandler_js_1.AppError(400, "Current password required to set a new password");
        const valid = await (0, crypto_js_1.verifyPassword)(body.currentPassword, user.password_hash);
        if (!valid)
            throw new errorHandler_js_1.AppError(401, "Current password is incorrect");
    }
    if (body.email && body.email.toLowerCase() !== user.email) {
        const [existing] = await pool_js_1.pool.execute(`SELECT id FROM users WHERE email = :email AND id != :id`, {
            email: body.email.toLowerCase(),
            id: req.user.id,
        });
        if (existing[0])
            throw new errorHandler_js_1.AppError(409, "Email already in use");
    }
    const updates = [];
    const params = { id: req.user.id };
    if (body.email) {
        updates.push("email = :email");
        params.email = body.email.toLowerCase();
    }
    if (body.firstName) {
        updates.push("first_name = :firstName");
        params.firstName = body.firstName;
    }
    if (body.lastName) {
        updates.push("last_name = :lastName");
        params.lastName = body.lastName;
    }
    if (body.phone !== undefined) {
        updates.push("phone = :phone");
        params.phone = body.phone;
    }
    if (body.newPassword) {
        updates.push("password_hash = :passwordHash");
        params.passwordHash = await (0, crypto_js_1.hashPassword)(body.newPassword);
    }
    if (updates.length === 0)
        throw new errorHandler_js_1.AppError(400, "No updates provided");
    await pool_js_1.pool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = :id`, params);
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.profile_updated",
        metadata: {
            email: body.email,
            firstName: body.firstName,
            lastName: body.lastName,
            passwordChanged: Boolean(body.newPassword),
        },
        ipAddress: req.ip ?? null,
    });
    const [updated] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, { id: req.user.id });
    res.json({ user: (0, audit_js_1.publicUser)(updated[0], true), message: "Profile updated" });
}));
exports.adminRouter.get("/audit", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const { from, to } = parseDateRange(req.query);
    const action = zod_1.z.string().optional().parse(req.query.action);
    const level = zod_1.z.enum(["info", "warn", "error"]).optional().parse(req.query.level);
    const limit = zod_1.z.coerce.number().int().min(1).max(500).default(200).parse(req.query.limit);
    const params = { limit };
    let sql = `
      SELECT a.*, u.email, u.first_name, u.last_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE 1=1`;
    sql += dateFilterSql("a.created_at", from, to, params);
    if (action) {
        sql += ` AND a.action LIKE :action`;
        params.action = `%${action}%`;
    }
    if (level) {
        sql += ` AND a.level = :level`;
        params.level = level;
    }
    sql += ` ORDER BY a.created_at DESC LIMIT :limit`;
    const [rows] = await pool_js_1.pool.execute(sql, params);
    res.json({
        entries: rows.map((a) => ({
            id: a.id,
            userId: a.user_id,
            userEmail: a.email,
            userName: a.first_name ? `${a.first_name} ${a.last_name}` : null,
            action: a.action,
            level: a.level,
            metadata: a.metadata ? JSON.parse(a.metadata) : null,
            ipAddress: a.ip_address,
            createdAt: new Date(a.created_at).toISOString(),
        })),
    });
}));
exports.adminRouter.get("/travel-credits", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const userId = zod_1.z.string().uuid().optional().parse(req.query.userId);
    const [balances, transactions] = await Promise.all([
        (0, travelCredits_js_1.listTravelCreditBalances)(),
        (0, travelCredits_js_1.listTravelCreditTransactions)(100, userId),
    ]);
    const totalOutstanding = balances.reduce((sum, row) => sum + row.balanceMwk, 0);
    res.json({
        totals: {
            accountsWithBalance: balances.filter((b) => b.balanceMwk > 0).length,
            totalOutstandingMwk: totalOutstanding,
        },
        balances,
        transactions,
    });
}));
const addTravelCreditSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    amountMwk: zod_1.z.number().positive(),
    description: zod_1.z.string().min(1).max(255),
    reference: zod_1.z.string().max(100).optional(),
});
exports.adminRouter.post("/travel-credits/bulk", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = addTravelCreditSchema.omit({ userId: true }).parse(req.body);
    const result = await (0, travelCredits_js_1.addTravelCreditToAllUsers)({
        amountMwk: body.amountMwk,
        description: body.description,
        reference: body.reference,
        createdBy: req.user.id,
    });
    res.status(201).json({
        message: `Travel credit issued to ${result.usersCredited} users`,
        usersCredited: result.usersCredited,
        totalIssuedMwk: result.totalIssuedMwk,
    });
}));
exports.adminRouter.post("/travel-credits", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = addTravelCreditSchema.parse(req.body);
    const result = await (0, travelCredits_js_1.addTravelCredit)({
        userId: body.userId,
        amountMwk: body.amountMwk,
        description: body.description,
        reference: body.reference,
        createdBy: req.user.id,
    });
    res.status(201).json({
        message: "Travel credit added",
        balanceMwk: result.balanceMwk,
        transactionId: result.transactionId,
    });
}));
exports.adminRouter.get("/tickets", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const [rows] = await pool_js_1.pool.execute(`SELECT t.*, b.pnr, u.email, u.first_name, u.last_name
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       JOIN users u ON u.id = t.user_id
       ORDER BY t.depart_at DESC LIMIT 200`);
    res.json({
        tickets: rows.map(mapAdminTicket),
    });
}));
function mapAdminTicket(t) {
    const departAt = new Date(t.depart_at).toISOString();
    const dbStatus = t.status;
    return {
        id: t.id,
        bookingId: t.booking_id,
        pnr: t.pnr,
        userId: t.user_id,
        userEmail: t.email,
        userName: t.first_name ? `${t.first_name} ${t.last_name}` : undefined,
        originCode: t.origin_code,
        destinationCode: t.destination_code,
        originCity: t.origin_city,
        destinationCity: t.destination_city,
        departAt,
        arriveAt: new Date(t.arrive_at).toISOString(),
        airline: t.airline,
        flightLabel: t.flight_label,
        seat: t.seat,
        gate: t.gate,
        class: t.class,
        status: dbStatus,
        displayStatus: (0, ticketUtils_js_1.ticketDisplayStatus)(departAt, dbStatus),
        passengerNames: t.passenger_names ?? null,
        applicationId: t.application_id ?? null,
    };
}
exports.adminRouter.get("/tickets/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const ticketId = zod_1.z.string().uuid().parse(req.params.id);
    const [rows] = await pool_js_1.pool.execute(`SELECT t.*, b.pnr, u.email, u.first_name, u.last_name, u.phone,
        fa.id AS application_id, fa.reference_number,
        (SELECT fat.id FROM flight_application_tickets fat WHERE fat.application_id = fa.id ORDER BY fat.created_at DESC LIMIT 1) AS app_ticket_id,
        (SELECT fat.file_name FROM flight_application_tickets fat WHERE fat.application_id = fa.id ORDER BY fat.created_at DESC LIMIT 1) AS app_ticket_file
       FROM tickets t
       JOIN bookings b ON b.id = t.booking_id
       JOIN users u ON u.id = t.user_id
       LEFT JOIN flight_applications fa ON fa.booking_id = t.booking_id
       WHERE t.id = :id`, { id: ticketId });
    const row = rows[0];
    if (!row)
        throw new errorHandler_js_1.AppError(404, "Ticket not found");
    res.json({
        ticket: mapAdminTicket(row),
        customer: {
            email: row.email,
            name: `${row.first_name} ${row.last_name}`,
            phone: row.phone,
        },
        application: row.application_id
            ? { id: row.application_id, referenceNumber: row.reference_number, appTicketId: row.app_ticket_id, fileName: row.app_ticket_file }
            : null,
    });
}));
const updateTicketSchema = zod_1.z.object({
    seat: zod_1.z.string().max(20).optional(),
    gate: zod_1.z.string().max(20).optional(),
    status: zod_1.z.enum(["confirmed", "completed", "cancelled"]).optional(),
    passengerNames: zod_1.z.string().max(500).optional(),
});
exports.adminRouter.patch("/tickets/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const ticketId = zod_1.z.string().uuid().parse(req.params.id);
    const body = updateTicketSchema.parse(req.body);
    const updates = [];
    const params = { id: ticketId };
    if (body.seat !== undefined) {
        updates.push("seat = :seat");
        params.seat = body.seat;
    }
    if (body.gate !== undefined) {
        updates.push("gate = :gate");
        params.gate = body.gate;
    }
    if (body.status) {
        updates.push("status = :status");
        params.status = body.status;
    }
    if (body.passengerNames !== undefined) {
        updates.push("passenger_names = :passengerNames");
        params.passengerNames = body.passengerNames;
    }
    if (updates.length === 0)
        throw new errorHandler_js_1.AppError(400, "No updates provided");
    await pool_js_1.pool.execute(`UPDATE tickets SET ${updates.join(", ")} WHERE id = :id`, params);
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.ticket_updated",
        metadata: { ticketId, ...body },
        ipAddress: req.ip ?? null,
    });
    res.json({ message: "Ticket updated" });
}));
exports.adminRouter.post("/tickets/:id/resend", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const ticketId = zod_1.z.string().uuid().parse(req.params.id);
    const [rows] = await pool_js_1.pool.execute(`SELECT t.*, u.first_name, u.last_name, u.email, fa.id AS application_id, fa.reference_number,
        fa.origin_code, fa.destination_code, fa.depart_date, fa.quoted_depart_date
       FROM tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN flight_applications fa ON fa.booking_id = t.booking_id
       WHERE t.id = :id`, { id: ticketId });
    const row = rows[0];
    if (!row)
        throw new errorHandler_js_1.AppError(404, "Ticket not found");
    if (!row.application_id)
        throw new errorHandler_js_1.AppError(400, "No application ticket file linked to this booking");
    const [files] = await pool_js_1.pool.execute(`SELECT file_name, mime_type, file_path, file_data FROM flight_application_tickets
       WHERE application_id = :applicationId ORDER BY created_at DESC LIMIT 1`, { applicationId: row.application_id });
    const file = files[0];
    if (!file)
        throw new errorHandler_js_1.AppError(404, "Ticket document not found");
    const fileContent = await (0, fileStorage_js_1.loadTicketFileContent)(file);
    const ctx = (0, applications_js_1.emailContextFromRow)({
        reference_number: row.reference_number,
        origin_code: row.origin_code,
        destination_code: row.destination_code,
        depart_date: row.quoted_depart_date ?? row.depart_date,
    }, `${row.first_name} ${row.last_name}`, row.email);
    const auditSummary = `Ticket re-sent manually by admin.\nRoute: ${row.origin_code}→${row.destination_code}\nPassengers: ${row.passenger_names ?? "-"}`;
    await (0, applicationEmails_js_1.emailApplicationCompleted)({
        ctx,
        auditSummary,
        attachments: [{ filename: file.file_name, content: fileContent, contentType: file.mime_type }],
    });
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.ticket_resent",
        metadata: { ticketId, applicationId: row.application_id },
        ipAddress: req.ip ?? null,
    });
    res.json({ message: "Ticket email sent to customer" });
}));
const routeSchema = zod_1.z.object({
    originCode: zod_1.z.string().length(3),
    originCity: zod_1.z.string().min(1).max(100),
    destinationCode: zod_1.z.string().length(3),
    destinationCity: zod_1.z.string().min(1).max(100),
    airline: zod_1.z.string().min(1).max(120),
    durationMinutes: zod_1.z.number().int().min(0).default(0),
    basePriceMwk: zod_1.z.number().positive(),
    cabinClass: zod_1.z.string().default("Economy"),
    isActive: zod_1.z.boolean().default(true),
    notes: zod_1.z.string().max(2000).optional(),
});
exports.adminRouter.get("/routes", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const [rows] = await pool_js_1.pool.execute(`SELECT r.*,
        (SELECT COUNT(*) FROM flight_departures fd WHERE fd.route_id = r.id) AS departure_count,
        (SELECT COUNT(*) FROM flight_departures fd WHERE fd.route_id = r.id AND fd.depart_at > UTC_TIMESTAMP()) AS upcoming_count
       FROM flight_routes r ORDER BY r.created_at DESC`);
    res.json({ routes: rows.map(mapRoute) });
}));
exports.adminRouter.post("/routes", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = routeSchema.parse(req.body);
    const id = (0, uuid_1.v4)();
    await pool_js_1.pool.execute(`INSERT INTO flight_routes (
        id, origin_code, origin_city, destination_code, destination_city,
        airline, duration_minutes, base_price_mwk, cabin_class, is_active, notes
      ) VALUES (
        :id, :originCode, :originCity, :destinationCode, :destinationCity,
        :airline, :durationMinutes, :basePriceMwk, :cabinClass, :isActive, :notes
      )`, {
        id,
        originCode: body.originCode.toUpperCase(),
        originCity: body.originCity,
        destinationCode: body.destinationCode.toUpperCase(),
        destinationCity: body.destinationCity,
        airline: body.airline,
        durationMinutes: body.durationMinutes,
        basePriceMwk: body.basePriceMwk,
        cabinClass: body.cabinClass,
        isActive: body.isActive ? 1 : 0,
        notes: body.notes ?? null,
    });
    await (0, audit_js_1.writeAuditLog)({
        userId: req.user.id,
        action: "admin.route_created",
        metadata: { routeId: id },
        ipAddress: req.ip ?? null,
    });
    res.status(201).json({ id, message: "Route created" });
}));
exports.adminRouter.get("/routes/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const routeId = zod_1.z.string().uuid().parse(req.params.id);
    const [routes] = await pool_js_1.pool.execute(`SELECT * FROM flight_routes WHERE id = :id`, { id: routeId });
    const route = routes[0];
    if (!route)
        throw new errorHandler_js_1.AppError(404, "Route not found");
    const [departures] = await pool_js_1.pool.execute(`SELECT fd.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.flight_departure_id = fd.id AND b.status != 'cancelled') AS booked_count
       FROM flight_departures fd
       WHERE fd.route_id = :routeId
       ORDER BY fd.depart_at ASC`, { routeId });
    res.json({
        route: mapRoute(route),
        departures: departures.map(mapDeparture),
    });
}));
exports.adminRouter.patch("/routes/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const routeId = zod_1.z.string().uuid().parse(req.params.id);
    const body = routeSchema.partial().parse(req.body);
    const updates = [];
    const params = { id: routeId };
    const map = {
        originCode: "origin_code",
        originCity: "origin_city",
        destinationCode: "destination_code",
        destinationCity: "destination_city",
        airline: "airline",
        durationMinutes: "duration_minutes",
        basePriceMwk: "base_price_mwk",
        cabinClass: "cabin_class",
        notes: "notes",
    };
    for (const [key, col] of Object.entries(map)) {
        const val = body[key];
        if (val !== undefined) {
            updates.push(`${col} = :${key}`);
            params[key] = key.includes("Code") && typeof val === "string" ? val.toUpperCase() : val;
        }
    }
    if (body.isActive !== undefined) {
        updates.push("is_active = :isActive");
        params.isActive = body.isActive ? 1 : 0;
    }
    if (updates.length === 0)
        throw new errorHandler_js_1.AppError(400, "No updates");
    await pool_js_1.pool.execute(`UPDATE flight_routes SET ${updates.join(", ")} WHERE id = :id`, params);
    res.json({ message: "Route updated" });
}));
const departureSchema = zod_1.z.object({
    flightNumber: zod_1.z.string().min(2).max(20),
    departAt: zod_1.z.string().datetime(),
    arriveAt: zod_1.z.string().datetime(),
    seatsTotal: zod_1.z.number().int().min(1).default(120),
    gate: zod_1.z.string().max(20).optional(),
    priceMwk: zod_1.z.number().positive().optional(),
    status: zod_1.z.enum(["scheduled", "delayed", "cancelled", "departed", "full"]).default("scheduled"),
});
exports.adminRouter.post("/routes/:id/departures", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const routeId = zod_1.z.string().uuid().parse(req.params.id);
    const body = departureSchema.parse(req.body);
    const id = (0, uuid_1.v4)();
    await pool_js_1.pool.execute(`INSERT INTO flight_departures (
        id, route_id, flight_number, depart_at, arrive_at, seats_total, seats_available, gate, price_mwk, status
      ) VALUES (
        :id, :routeId, :flightNumber, :departAt, :arriveAt, :seatsTotal, :seatsTotal, :gate, :priceMwk, :status
      )`, {
        id,
        routeId,
        flightNumber: body.flightNumber,
        departAt: body.departAt,
        arriveAt: body.arriveAt,
        seatsTotal: body.seatsTotal,
        gate: body.gate ?? null,
        priceMwk: body.priceMwk ?? null,
        status: body.status,
    });
    res.status(201).json({ id, message: "Departure scheduled" });
}));
exports.adminRouter.get("/departures/:id/bookings", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const departureId = zod_1.z.string().uuid().parse(req.params.id);
    const [departures] = await pool_js_1.pool.execute(`SELECT fd.*, r.origin_code, r.origin_city, r.destination_code, r.destination_city, r.airline, r.cabin_class
       FROM flight_departures fd
       JOIN flight_routes r ON r.id = fd.route_id
       WHERE fd.id = :id`, { id: departureId });
    const departure = departures[0];
    if (!departure)
        throw new errorHandler_js_1.AppError(404, "Departure not found");
    const [bookings] = await pool_js_1.pool.execute(`SELECT b.*, u.email, u.first_name, u.last_name, u.phone, u.status AS user_status
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       WHERE b.flight_departure_id = :departureId AND b.status != 'cancelled'
       ORDER BY b.created_at ASC`, { departureId });
    res.json({
        departure: mapDeparture(departure),
        route: {
            originCode: departure.origin_code,
            originCity: departure.origin_city,
            destinationCode: departure.destination_code,
            destinationCity: departure.destination_city,
            airline: departure.airline,
            cabinClass: departure.cabin_class,
        },
        bookings: bookings.map((b) => ({
            ...mapBooking(b),
            userEmail: b.email,
            userName: `${b.first_name} ${b.last_name}`,
            userPhone: b.phone,
            userStatus: b.user_status,
        })),
    });
}));
exports.adminRouter.get("/bookings/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const bookingId = zod_1.z.string().uuid().parse(req.params.id);
    const [bookings] = await pool_js_1.pool.execute(`SELECT b.*, u.email, u.first_name, u.last_name, u.phone, u.status AS user_status
       FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = :id`, { id: bookingId });
    const booking = bookings[0];
    if (!booking)
        throw new errorHandler_js_1.AppError(404, "Booking not found");
    const [tickets] = await pool_js_1.pool.execute(`SELECT * FROM tickets WHERE booking_id = :id ORDER BY segment_order`, { id: bookingId });
    res.json({
        booking: {
            ...mapBooking(booking),
            userEmail: booking.email,
            userName: `${booking.first_name} ${booking.last_name}`,
            userPhone: booking.phone,
            userStatus: booking.user_status,
        },
        tickets: tickets.map((t) => ({
            id: t.id,
            seat: t.seat,
            gate: t.gate,
            status: t.status,
            flightLabel: t.flight_label,
        })),
    });
}));
function mapBooking(row) {
    return {
        id: row.id,
        userId: row.user_id,
        flightDepartureId: row.flight_departure_id,
        pnr: row.pnr,
        status: row.status,
        originCode: row.origin_code,
        originCity: row.origin_city,
        destinationCode: row.destination_code,
        destinationCity: row.destination_city,
        airline: row.airline,
        flightNumber: row.flight_number,
        departAt: new Date(row.depart_at).toISOString(),
        arriveAt: new Date(row.arrive_at).toISOString(),
        cabinClass: row.cabin_class,
        priceMwk: Number(row.price_mwk),
        createdAt: new Date(row.created_at).toISOString(),
    };
}
function mapIssue(row) {
    return {
        id: row.id,
        severity: row.severity,
        title: row.title,
        description: row.description,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
    };
}
function mapLedger(row) {
    return {
        id: row.id,
        userId: row.user_id,
        bookingId: row.booking_id,
        entryType: row.entry_type,
        amountMwk: Number(row.amount_mwk),
        description: row.description,
        reference: row.reference,
        createdAt: new Date(row.created_at).toISOString(),
    };
}
function mapRoute(row) {
    return {
        id: row.id,
        originCode: row.origin_code,
        originCity: row.origin_city,
        destinationCode: row.destination_code,
        destinationCity: row.destination_city,
        airline: row.airline,
        durationMinutes: Number(row.duration_minutes),
        basePriceMwk: Number(row.base_price_mwk),
        cabinClass: row.cabin_class,
        isActive: Boolean(row.is_active),
        notes: row.notes,
        departureCount: Number(row.departure_count ?? 0),
        upcomingCount: Number(row.upcoming_count ?? 0),
        createdAt: new Date(row.created_at).toISOString(),
    };
}
function mapDeparture(row) {
    return {
        id: row.id,
        routeId: row.route_id,
        flightNumber: row.flight_number,
        departAt: new Date(row.depart_at).toISOString(),
        arriveAt: new Date(row.arrive_at).toISOString(),
        seatsTotal: Number(row.seats_total),
        seatsAvailable: Number(row.seats_available),
        bookedCount: Number(row.booked_count ?? 0),
        gate: row.gate,
        status: row.status,
        priceMwk: row.price_mwk ? Number(row.price_mwk) : null,
    };
}
