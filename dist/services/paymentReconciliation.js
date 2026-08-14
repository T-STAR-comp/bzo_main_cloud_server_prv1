"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPaymentReconciliation = startPaymentReconciliation;
exports.runHourlyReconciliation = runHourlyReconciliation;
const logger_js_1 = require("../logger.js");
const paymentLedger_js_1 = require("./paymentLedger.js");
const HOUR_MS = 60 * 60 * 1000;
function startPaymentReconciliation() {
    setInterval(() => {
        void runHourlyReconciliation();
    }, HOUR_MS);
    setTimeout(() => {
        void runHourlyReconciliation();
    }, 15_000);
    logger_js_1.logger.info("Payment reconciliation scheduled (hourly pending verify + completed order confirm)");
}
async function runHourlyReconciliation() {
    try {
        logger_js_1.logger.info("Running hourly payment ledger reconciliation…");
        const pending = await (0, paymentLedger_js_1.listAllPendingLedgers)(500);
        for (const row of pending) {
            try {
                await (0, paymentLedger_js_1.verifyAndProcessLedger)(row);
            }
            catch (error) {
                logger_js_1.logger.warn(`Hourly verify failed for ledger ${row.id}`, error);
            }
        }
        const since = new Date(Date.now() - HOUR_MS);
        const completedRecent = await (0, paymentLedger_js_1.listRecentlyCompletedLedgers)(since);
        for (const row of completedRecent) {
            if (row.order_fulfilled_at) {
                continue;
            }
            try {
                await (0, paymentLedger_js_1.fulfillOrderForLedger)(row.id);
                logger_js_1.logger.info(`Reconciliation fulfilled order for ledger ${row.id}`);
            }
            catch (error) {
                logger_js_1.logger.error(`Reconciliation fulfillment failed for ledger ${row.id}`, error);
            }
        }
        logger_js_1.logger.info(`Hourly reconciliation done — checked ${pending.length} pending, ${completedRecent.length} recent completed`);
    }
    catch (error) {
        logger_js_1.logger.warn("Hourly payment reconciliation skipped — database unavailable", error);
    }
}
