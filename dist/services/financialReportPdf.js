"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderFinancialReportPdf = renderFinancialReportPdf;
exports.renderReportEmailHtml = renderReportEmailHtml;
const pdfkit_1 = __importDefault(require("pdfkit"));
const INK = "#1A1A1A";
const SIGNAL = "#E86B1A";
const SIGNAL_SOFT = "#FFF4EC";
const MUTED = "#6B7280";
const HAIRLINE = "#E8E8E8";
const WHITE = "#FFFFFF";
const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
function formatMwk(n) {
    return `MWK ${Math.round(n).toLocaleString("en-MW")}`;
}
function formatDate(iso) {
    return iso.slice(0, 10);
}
function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function truncate(text, max) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
function drawLogoMark(doc, x, y, size) {
    const scale = size / 48;
    doc.save();
    doc.translate(x, y);
    doc.scale(scale);
    doc.roundedRect(2, 2, 22, 44, 2).fill(INK);
    doc.roundedRect(24, 2, 22, 44, 2).fill(SIGNAL);
    doc
        .polygon([24, 6], [30, 22], [46, 24], [30, 26], [24, 42], [18, 26], [2, 24], [18, 22])
        .fill(WHITE);
    doc.restore();
}
function drawPageHeader(doc, title, periodLabel) {
    doc.rect(0, 0, PAGE.width, 88).fill(SIGNAL);
    drawLogoMark(doc, PAGE.margin, 22, 44);
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(22).text("BIAZO", PAGE.margin + 56, 26);
    doc.font("Helvetica").fontSize(8).text("TRAVELING AGENCY", PAGE.margin + 56, 50, { characterSpacing: 1.2 });
    doc.font("Helvetica-Bold").fontSize(11).text(title, PAGE.margin + 56, 62);
    doc.font("Helvetica").fontSize(9).text(periodLabel, PAGE.margin + 56, 76);
    doc
        .fillColor(WHITE)
        .font("Helvetica")
        .fontSize(8)
        .text(`Generated ${formatDateTime(new Date().toISOString())}`, 0, 32, {
        width: PAGE.width - PAGE.margin,
        align: "right",
    });
}
function drawSectionTitle(doc, y, title) {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(title, PAGE.margin, y);
    doc
        .moveTo(PAGE.margin, y + 18)
        .lineTo(PAGE.width - PAGE.margin, y + 18)
        .strokeColor(SIGNAL)
        .lineWidth(2)
        .stroke();
    return y + 28;
}
function drawMetricCard(doc, x, y, w, h, label, value, accent = false) {
    doc.roundedRect(x, y, w, h, 6).fill(accent ? SIGNAL_SOFT : WHITE);
    doc.roundedRect(x, y, w, h, 6).strokeColor(accent ? SIGNAL : HAIRLINE).lineWidth(accent ? 1.5 : 1).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(label.toUpperCase(), x + 12, y + 12, { width: w - 24 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(accent ? 14 : 12).text(value, x + 12, y + 28, { width: w - 24 });
}
function ensureSpace(doc, y, needed, headerTitle, periodLabel) {
    if (y + needed <= PAGE.height - PAGE.margin)
        return y;
    doc.addPage();
    drawCompactHeader(doc, headerTitle, periodLabel);
    return 108;
}
function drawCompactHeader(doc, title, periodLabel) {
    doc.rect(0, 0, PAGE.width, 56).fill(SIGNAL_SOFT);
    drawLogoMark(doc, PAGE.margin, 10, 36);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text("BIAZO Financial Report", PAGE.margin + 46, 14);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`${title} · ${periodLabel}`, PAGE.margin + 46, 30);
    doc
        .strokeColor(HAIRLINE)
        .moveTo(PAGE.margin, 56)
        .lineTo(PAGE.width - PAGE.margin, 56)
        .stroke();
}
function drawTable(doc, y, columns, rows, headerTitle, periodLabel) {
    const rowHeight = 22;
    const headerHeight = 26;
    let currentY = y;
    const drawTableHeader = () => {
        doc.roundedRect(PAGE.margin, currentY, CONTENT_WIDTH, headerHeight, 4).fill(INK);
        let x = PAGE.margin + 8;
        columns.forEach((col) => {
            doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8).text(col.label.toUpperCase(), x, currentY + 8, {
                width: col.width - 12,
                align: col.align ?? "left",
            });
            x += col.width;
        });
        currentY += headerHeight;
    };
    drawTableHeader();
    rows.forEach((row, index) => {
        currentY = ensureSpace(doc, currentY, rowHeight + 8, headerTitle, periodLabel);
        if (currentY === 108)
            drawTableHeader();
        const bg = index % 2 === 0 ? WHITE : "#FAFAFA";
        doc.rect(PAGE.margin, currentY, CONTENT_WIDTH, rowHeight).fill(bg);
        doc.rect(PAGE.margin, currentY, CONTENT_WIDTH, rowHeight).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
        let x = PAGE.margin + 8;
        row.forEach((cell, colIndex) => {
            const col = columns[colIndex];
            doc.fillColor(INK).font("Helvetica").fontSize(8).text(cell, x, currentY + 7, {
                width: col.width - 12,
                align: col.align ?? "left",
                lineBreak: false,
            });
            x += col.width;
        });
        currentY += rowHeight;
    });
    return currentY + 12;
}
function renderFinancialReportPdf(data) {
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({ size: "A4", margin: 0, bufferPages: true });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        const { financeLedger: f, paymentLedger: p, travelCredits: tc, period } = data;
        const periodLabel = `${formatDate(period.from.toISOString())} — ${formatDate(period.to.toISOString())}`;
        const reportTitle = `${period.label} Financial Report`;
        drawPageHeader(doc, reportTitle, periodLabel);
        let y = 108;
        y = drawSectionTitle(doc, y, "Executive summary");
        const cardW = (CONTENT_WIDTH - 18) / 4;
        const cardH = 58;
        const metrics = [
            ["Gross revenue", formatMwk(f.grossRevenueMwk), true],
            ["Net revenue", formatMwk(f.netRevenueMwk), true],
            ["Payments", formatMwk(f.paymentsMwk), false],
            ["Refunds", formatMwk(f.refundsMwk), false],
            ["Fees", formatMwk(f.feesMwk), false],
            ["Credits issued", formatMwk(f.creditsMwk), false],
            ["Payouts", formatMwk(f.payoutsMwk), false],
            ["Adjustments", formatMwk(f.adjustmentsMwk), false],
        ];
        metrics.forEach(([label, value, accent], i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            drawMetricCard(doc, PAGE.margin + col * (cardW + 6), y + row * (cardH + 8), cardW, cardH, label, value, accent);
        });
        y += Math.ceil(metrics.length / 4) * (cardH + 8) + 16;
        y = drawSectionTitle(doc, y, "Payment overview");
        const payCards = [
            ["Completed", `${p.completedCount} · ${formatMwk(p.completedMwk)}`],
            ["Pending", String(p.pendingCount)],
            ["Failed", String(p.failedCount)],
            ["Expired", String(p.expiredCount)],
        ];
        payCards.forEach(([label, value], i) => {
            drawMetricCard(doc, PAGE.margin + i * (cardW + 6), y, cardW, cardH, label, value, i === 0);
        });
        y += cardH + 16;
        const methods = Object.entries(p.byMethod);
        if (methods.length > 0) {
            doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("By payment method", PAGE.margin, y);
            y += 16;
            methods.forEach(([method, stats], i) => {
                const label = method.replace(/_/g, " ");
                doc
                    .fillColor(INK)
                    .font("Helvetica")
                    .fontSize(9)
                    .text(`${label}: ${stats.count} payments · ${formatMwk(stats.amountMwk)} completed`, PAGE.margin + (i % 2) * (CONTENT_WIDTH / 2), y + Math.floor(i / 2) * 14);
            });
            y += Math.ceil(methods.length / 2) * 14 + 12;
        }
        y = drawSectionTitle(doc, y, "Travel credits");
        drawMetricCard(doc, PAGE.margin, y, cardW, cardH, "Issued in period", formatMwk(tc.creditsIssuedMwk), false);
        drawMetricCard(doc, PAGE.margin + cardW + 6, y, cardW, cardH, "Redeemed in period", formatMwk(tc.creditsRedeemedMwk), false);
        drawMetricCard(doc, PAGE.margin + (cardW + 6) * 2, y, cardW, cardH, "Outstanding balance", formatMwk(tc.outstandingBalanceMwk), true);
        y += cardH + 24;
        // Finance ledger
        doc.addPage();
        drawCompactHeader(doc, reportTitle, periodLabel);
        y = 72;
        y = drawSectionTitle(doc, y, `Finance ledger (${f.entries.length} entries)`);
        y = drawTable(doc, y, [
            { label: "Date", width: 72 },
            { label: "Type", width: 64 },
            { label: "Amount", width: 88, align: "right" },
            { label: "Description", width: 140 },
            { label: "Customer", width: CONTENT_WIDTH - 364 },
        ], f.entries.map((e) => [
            formatDate(e.createdAt),
            e.entryType,
            formatMwk(e.amountMwk),
            truncate(e.description, 28),
            truncate(e.userEmail ?? e.userName ?? "—", 32),
        ]), reportTitle, periodLabel);
        // Payment ledger
        y = ensureSpace(doc, y, 80, reportTitle, periodLabel);
        if (y === 108)
            drawCompactHeader(doc, reportTitle, periodLabel);
        y = drawSectionTitle(doc, y, `Payment ledger (${p.entries.length} entries)`);
        y = drawTable(doc, y, [
            { label: "Date", width: 68 },
            { label: "Status", width: 58 },
            { label: "Method", width: 72 },
            { label: "Amount", width: 82, align: "right" },
            { label: "Charge ID", width: 110 },
            { label: "Customer", width: CONTENT_WIDTH - 390 },
        ], p.entries.map((e) => [
            formatDate(e.createdAt),
            e.status,
            e.paymentMethod.replace(/_/g, " "),
            formatMwk(e.amountMwk),
            truncate(e.chargeId, 18),
            truncate(e.userEmail, 28),
        ]), reportTitle, periodLabel);
        // Travel credit transactions
        if (tc.transactions.length > 0) {
            y = ensureSpace(doc, y, 80, reportTitle, periodLabel);
            if (y === 108)
                drawCompactHeader(doc, reportTitle, periodLabel);
            y = drawSectionTitle(doc, y, `Travel credit transactions (${tc.transactions.length})`);
            y = drawTable(doc, y, [
                { label: "Date", width: 72 },
                { label: "Type", width: 64 },
                { label: "Amount", width: 88, align: "right" },
                { label: "Customer", width: 130 },
                { label: "Description", width: CONTENT_WIDTH - 354 },
            ], tc.transactions.map((t) => [
                formatDate(t.createdAt),
                t.entryType,
                formatMwk(t.amountMwk),
                truncate(t.userEmail, 24),
                truncate(t.description, 36),
            ]), reportTitle, periodLabel);
        }
        // Audit highlights
        if (data.auditHighlights.length > 0) {
            y = ensureSpace(doc, y, 80, reportTitle, periodLabel);
            if (y === 108)
                drawCompactHeader(doc, reportTitle, periodLabel);
            y = drawSectionTitle(doc, y, `Audit highlights (${data.auditHighlights.length})`);
            y = drawTable(doc, y, [
                { label: "Date", width: 72 },
                { label: "Level", width: 52 },
                { label: "Action", width: CONTENT_WIDTH - 124 },
            ], data.auditHighlights.map((a) => [formatDate(a.createdAt), a.level, truncate(a.action, 80)]), reportTitle, periodLabel);
        }
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            doc
                .fillColor(MUTED)
                .font("Helvetica")
                .fontSize(8)
                .text(`Biazo Traveling Agency · Confidential financial report · Page ${i + 1} of ${range.count}`, PAGE.margin, PAGE.height - 32, { width: CONTENT_WIDTH, align: "center" });
        }
        doc.end();
    });
}
function renderReportEmailHtml(data) {
    const { financeLedger: f, paymentLedger: p, travelCredits: tc, period } = data;
    const periodLabel = `${formatDate(period.from.toISOString())} — ${formatDate(period.to.toISOString())}`;
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#E86B1A;padding:28px 32px;">
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">BIAZO</p>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Traveling Agency</p>
          <p style="margin:16px 0 0;color:#ffffff;font-size:16px;font-weight:600;">${period.label} Financial Report</p>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${periodLabel}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 20px;color:#1A1A1A;font-size:15px;">Your financial report is attached as a PDF with full ledger details for the period.</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="48%" style="background:#FFF4EC;border:1px solid #E86B1A;border-radius:8px;padding:16px;vertical-align:top;">
                <p style="margin:0;color:#6B7280;font-size:10px;text-transform:uppercase;">Gross revenue</p>
                <p style="margin:6px 0 0;color:#1A1A1A;font-size:20px;font-weight:bold;">${formatMwk(f.grossRevenueMwk)}</p>
              </td>
              <td width="4%"></td>
              <td width="48%" style="background:#FAFAFA;border:1px solid #E8E8E8;border-radius:8px;padding:16px;vertical-align:top;">
                <p style="margin:0;color:#6B7280;font-size:10px;text-transform:uppercase;">Net revenue</p>
                <p style="margin:6px 0 0;color:#1A1A1A;font-size:20px;font-weight:bold;">${formatMwk(f.netRevenueMwk)}</p>
              </td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
            <tr>
              <td style="padding:8px 0;color:#6B7280;font-size:13px;">Payments</td>
              <td style="padding:8px 0;color:#1A1A1A;font-size:13px;text-align:right;font-weight:600;">${formatMwk(f.paymentsMwk)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6B7280;font-size:13px;">Refunds</td>
              <td style="padding:8px 0;color:#1A1A1A;font-size:13px;text-align:right;font-weight:600;">${formatMwk(f.refundsMwk)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6B7280;font-size:13px;">Completed payments</td>
              <td style="padding:8px 0;color:#1A1A1A;font-size:13px;text-align:right;font-weight:600;">${p.completedCount} (${formatMwk(p.completedMwk)})</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6B7280;font-size:13px;">Travel credits outstanding</td>
              <td style="padding:8px 0;color:#1A1A1A;font-size:13px;text-align:right;font-weight:600;">${formatMwk(tc.outstandingBalanceMwk)}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#FAFAFA;border-top:1px solid #E8E8E8;">
          <p style="margin:0;color:#6B7280;font-size:11px;text-align:center;">Biazo Traveling Agency · Lilongwe, Malawi · Confidential</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
