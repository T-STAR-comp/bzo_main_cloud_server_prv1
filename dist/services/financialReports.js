"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFinancialReport = buildFinancialReport;
exports.sendFinancialReport = sendFinancialReport;
exports.periodForReportType = periodForReportType;
const uuid_1 = require("uuid");
const pool_js_1 = require("../db/pool.js");
const mailer_js_1 = require("./mailer.js");
const platformSettings_js_1 = require("./platformSettings.js");
const audit_js_1 = require("./audit.js");
const financialReportPdf_js_1 = require("./financialReportPdf.js");
function formatMwk(n) {
    return `MWK ${Math.round(n).toLocaleString()}`;
}
async function buildFinancialReport(from, to, label) {
    const fromSql = from.toISOString().slice(0, 19).replace("T", " ");
    const toSql = to.toISOString().slice(0, 19).replace("T", " ");
    const [financeEntries] = await pool_js_1.pool.execute(`SELECT fl.*, u.email, u.first_name, u.last_name
     FROM finance_ledger fl
     LEFT JOIN users u ON u.id = fl.user_id
     WHERE fl.created_at >= :from AND fl.created_at < :to
     ORDER BY fl.created_at ASC`, { from: fromSql, to: toSql });
    const [[financeTotals]] = await pool_js_1.pool.execute(`SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN amount_mwk ELSE 0 END), 0) AS payments,
      COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN amount_mwk ELSE 0 END), 0) AS refunds,
      COALESCE(SUM(CASE WHEN entry_type = 'fee' THEN amount_mwk ELSE 0 END), 0) AS fees,
      COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_mwk ELSE 0 END), 0) AS credits,
      COALESCE(SUM(CASE WHEN entry_type = 'payout' THEN amount_mwk ELSE 0 END), 0) AS payouts,
      COALESCE(SUM(CASE WHEN entry_type = 'adjustment' THEN amount_mwk ELSE 0 END), 0) AS adjustments
     FROM finance_ledger WHERE created_at >= :from AND created_at < :to`, { from: fromSql, to: toSql });
    const [paymentRows] = await pool_js_1.pool.execute(`SELECT pl.*, u.email, u.first_name, u.last_name
     FROM payment_ledger pl
     JOIN users u ON u.id = pl.user_id
     WHERE pl.created_at >= :from AND pl.created_at < :to
     ORDER BY pl.created_at ASC`, { from: fromSql, to: toSql });
    const [creditTx] = await pool_js_1.pool.execute(`SELECT t.*, u.email
     FROM travel_credit_transactions t
     JOIN users u ON u.id = t.user_id
     WHERE t.created_at >= :from AND t.created_at < :to
     ORDER BY t.created_at ASC`, { from: fromSql, to: toSql });
    const [[creditTotals]] = await pool_js_1.pool.execute(`SELECT
      COALESCE(SUM(CASE WHEN entry_type IN ('credit','adjustment') THEN amount_mwk ELSE 0 END), 0) AS issued,
      COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount_mwk ELSE 0 END), 0) AS redeemed
     FROM travel_credit_transactions WHERE created_at >= :from AND created_at < :to`, { from: fromSql, to: toSql });
    const [[outstanding]] = await pool_js_1.pool.execute(`SELECT COALESCE(SUM(balance_mwk), 0) AS total FROM travel_credit`);
    const [auditRows] = await pool_js_1.pool.execute(`SELECT action, level, metadata, created_at FROM audit_logs
     WHERE created_at >= :from AND created_at < :to
     ORDER BY created_at DESC LIMIT 50`, { from: fromSql, to: toSql });
    const paymentsMwk = Number(financeTotals.payments);
    const feesMwk = Number(financeTotals.fees);
    const refundsMwk = Number(financeTotals.refunds);
    const byMethod = {};
    for (const row of paymentRows) {
        const method = row.payment_method;
        if (!byMethod[method])
            byMethod[method] = { count: 0, amountMwk: 0 };
        byMethod[method].count += 1;
        if (row.status === "completed") {
            byMethod[method].amountMwk += Number(row.amount_mwk);
        }
    }
    return {
        period: { from, to, label },
        financeLedger: {
            paymentsMwk,
            refundsMwk,
            feesMwk,
            creditsMwk: Number(financeTotals.credits),
            payoutsMwk: Number(financeTotals.payouts),
            adjustmentsMwk: Number(financeTotals.adjustments),
            grossRevenueMwk: paymentsMwk + feesMwk,
            netRevenueMwk: paymentsMwk + feesMwk - refundsMwk,
            entries: financeEntries.map((e) => ({
                id: e.id,
                entryType: e.entry_type,
                amountMwk: Number(e.amount_mwk),
                description: e.description,
                userName: e.first_name ? `${e.first_name} ${e.last_name}` : null,
                userEmail: e.email ?? null,
                reference: e.reference ?? null,
                createdAt: new Date(e.created_at).toISOString(),
            })),
        },
        paymentLedger: {
            completedCount: paymentRows.filter((r) => r.status === "completed").length,
            pendingCount: paymentRows.filter((r) => r.status === "pending").length,
            failedCount: paymentRows.filter((r) => r.status === "failed").length,
            expiredCount: paymentRows.filter((r) => r.status === "expired").length,
            completedMwk: paymentRows
                .filter((r) => r.status === "completed")
                .reduce((s, r) => s + Number(r.amount_mwk), 0),
            byMethod,
            entries: paymentRows.map((r) => ({
                id: r.id,
                chargeId: r.charge_id,
                paymentMethod: r.payment_method,
                status: r.status,
                amountMwk: Number(r.amount_mwk),
                currency: r.currency,
                userName: `${r.first_name} ${r.last_name}`,
                userEmail: r.email,
                completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
                createdAt: new Date(r.created_at).toISOString(),
            })),
        },
        travelCredits: {
            creditsIssuedMwk: Number(creditTotals.issued),
            creditsRedeemedMwk: Number(creditTotals.redeemed),
            outstandingBalanceMwk: Number(outstanding.total),
            transactions: creditTx.map((t) => ({
                entryType: t.entry_type,
                amountMwk: Number(t.amount_mwk),
                description: t.description,
                userEmail: t.email,
                createdAt: new Date(t.created_at).toISOString(),
            })),
        },
        auditHighlights: auditRows.map((a) => ({
            action: a.action,
            level: a.level,
            createdAt: new Date(a.created_at).toISOString(),
            metadata: a.metadata,
        })),
    };
}
function renderReportText(data) {
    const { financeLedger: f, paymentLedger: p, travelCredits: tc } = data;
    const lines = [
        `Biazo Financial Report — ${data.period.label}`,
        `Period: ${data.period.from.toISOString().slice(0, 10)} to ${data.period.to.toISOString().slice(0, 10)}`,
        "",
        "=== SUMMARY ===",
        `Gross revenue: ${formatMwk(f.grossRevenueMwk)}`,
        `Net revenue: ${formatMwk(f.netRevenueMwk)}`,
        `Payments: ${formatMwk(f.paymentsMwk)}`,
        `Refunds: ${formatMwk(f.refundsMwk)}`,
        `Fees: ${formatMwk(f.feesMwk)}`,
        `Finance credits issued: ${formatMwk(f.creditsMwk)}`,
        `Payouts: ${formatMwk(f.payoutsMwk)}`,
        `Adjustments: ${formatMwk(f.adjustmentsMwk)}`,
        "",
        "=== PAYMENT LEDGER ===",
        `Completed: ${p.completedCount} (${formatMwk(p.completedMwk)})`,
        `Pending: ${p.pendingCount} · Failed: ${p.failedCount} · Expired: ${p.expiredCount}`,
        ...Object.entries(p.byMethod).map(([method, stats]) => `  ${method}: ${stats.count} payments, ${formatMwk(stats.amountMwk)} completed`),
        "",
        "=== TRAVEL CREDITS ===",
        `Issued in period: ${formatMwk(tc.creditsIssuedMwk)}`,
        `Redeemed in period: ${formatMwk(tc.creditsRedeemedMwk)}`,
        `Total outstanding (all users): ${formatMwk(tc.outstandingBalanceMwk)}`,
        "",
        "=== FINANCE LEDGER ENTRIES ===",
        ...f.entries.map((e) => `${e.createdAt.slice(0, 10)} · ${e.entryType} · ${formatMwk(e.amountMwk)} · ${e.description}${e.userEmail ? ` · ${e.userEmail}` : ""}`),
        "",
        "=== PAYMENT LEDGER ENTRIES ===",
        ...p.entries.map((e) => `${e.createdAt.slice(0, 10)} · ${e.status} · ${e.paymentMethod} · ${formatMwk(e.amountMwk)} · ${e.chargeId} · ${e.userEmail}`),
        "",
        "=== TRAVEL CREDIT TRANSACTIONS ===",
        ...tc.transactions.map((t) => `${t.createdAt.slice(0, 10)} · ${t.entryType} · ${formatMwk(t.amountMwk)} · ${t.userEmail} · ${t.description}`),
        "",
        "=== AUDIT HIGHLIGHTS (last 50 in period) ===",
        ...data.auditHighlights.map((a) => `${a.createdAt.slice(0, 10)} · ${a.level} · ${a.action}`),
    ];
    return lines.join("\n");
}
async function sendFinancialReport(from, to, label, reportType, recipientEmail, requestedBy) {
    const settings = await (0, platformSettings_js_1.getPlatformSettings)();
    const toEmail = recipientEmail ?? settings.reportEmail;
    const data = await buildFinancialReport(from, to, label);
    const body = renderReportText(data);
    const pdfBuffer = await (0, financialReportPdf_js_1.renderFinancialReportPdf)(data);
    const periodSlug = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
    const pdfFilename = `biazo-financial-report-${reportType}-${periodSlug}.pdf`;
    await (0, mailer_js_1.sendMail)({
        to: toEmail,
        subject: `Biazo ${label} financial report`,
        text: `${body}\n\nA detailed PDF report is attached.`,
        html: (0, financialReportPdf_js_1.renderReportEmailHtml)(data),
        attachments: [
            {
                filename: pdfFilename,
                content: pdfBuffer,
                contentType: "application/pdf",
            },
        ],
    });
    const logId = (0, uuid_1.v4)();
    await pool_js_1.pool.execute(`INSERT INTO report_schedule_log (id, report_type, period_start, period_end, sent_to, requested_by)
     VALUES (:id, :type, :from, :to, :sentTo, :requestedBy)`, {
        id: logId,
        type: reportType,
        from: from.toISOString().slice(0, 19).replace("T", " "),
        to: to.toISOString().slice(0, 19).replace("T", " "),
        sentTo: toEmail,
        requestedBy: requestedBy ?? null,
    });
    if (requestedBy) {
        await (0, audit_js_1.writeAuditLog)({
            userId: requestedBy,
            action: "finance.report_sent",
            metadata: { reportType, from: from.toISOString(), to: to.toISOString(), sentTo: toEmail },
        });
    }
    return { reportId: logId, sentTo: toEmail, data };
}
function periodForReportType(type) {
    const now = new Date();
    const to = new Date(now);
    to.setUTCHours(0, 0, 0, 0);
    if (type === "weekly") {
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - 7);
        return { from, to, label: "Weekly" };
    }
    if (type === "monthly") {
        const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, to.getUTCDate()));
        return { from, to, label: "Monthly" };
    }
    if (type === "quarterly") {
        const from = new Date(to);
        from.setUTCMonth(from.getUTCMonth() - 3);
        return { from, to, label: "Quarterly" };
    }
    if (type === "biannual") {
        const from = new Date(to);
        from.setUTCMonth(from.getUTCMonth() - 6);
        return { from, to, label: "Bi-yearly" };
    }
    const from = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()));
    return { from, to, label: "Yearly" };
}
