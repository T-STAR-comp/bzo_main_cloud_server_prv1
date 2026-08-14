"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScheduledReports = runScheduledReports;
exports.startReportScheduler = startReportScheduler;
const pool_js_1 = require("../db/pool.js");
const logger_js_1 = require("../logger.js");
const financialReports_js_1 = require("./financialReports.js");
const platformSettings_js_1 = require("./platformSettings.js");
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
async function lastReportSent(type) {
    const [rows] = await pool_js_1.pool.execute(`SELECT period_end FROM report_schedule_log WHERE report_type = :type ORDER BY created_at DESC LIMIT 1`, { type });
    return rows[0]?.period_end ? new Date(rows[0].period_end) : null;
}
function isDue(lastEnd, minDays) {
    if (!lastEnd)
        return true;
    const daysSince = (Date.now() - lastEnd.getTime()) / (24 * 60 * 60 * 1000);
    return daysSince >= minDays;
}
async function maybeSend(type, minDays) {
    const settings = await (0, platformSettings_js_1.getPlatformSettings)();
    if (!settings.reportSchedules[type])
        return;
    const last = await lastReportSent(type);
    if (!isDue(last, minDays))
        return;
    const period = (0, financialReports_js_1.periodForReportType)(type);
    try {
        await (0, financialReports_js_1.sendFinancialReport)(period.from, period.to, period.label, type);
        logger_js_1.logger.info(`Scheduled ${type} financial report sent`);
    }
    catch (error) {
        logger_js_1.logger.error(`Failed to send ${type} financial report`, error);
    }
}
async function runScheduledReports() {
    await maybeSend("weekly", 7);
    await maybeSend("monthly", 28);
    await maybeSend("quarterly", 89);
    await maybeSend("biannual", 179);
    await maybeSend("yearly", 364);
}
function startReportScheduler() {
    const safeRun = () => {
        void runScheduledReports().catch((error) => {
            logger_js_1.logger.error("Financial report scheduler run failed", error);
        });
    };
    safeRun();
    setInterval(safeRun, CHECK_INTERVAL_MS);
    logger_js_1.logger.info("Financial report scheduler started");
}
