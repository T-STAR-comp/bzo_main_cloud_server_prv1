"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPaymentPoller = startPaymentPoller;
exports.watchPaymentLedger = watchPaymentLedger;
const logger_js_1 = require("../logger.js");
const paymentLedger_js_1 = require("./paymentLedger.js");
const POLL_INTERVAL_MS = 12_000;
const activePolls = new Map();
function startPaymentPoller() {
    void resumeActivePolls();
    setInterval(() => {
        void resumeActivePolls();
    }, 60_000);
    logger_js_1.logger.info("Payment poller started (12s interval during verification windows)");
}
function stopPolling(ledgerId) {
    const timer = activePolls.get(ledgerId);
    if (timer) {
        clearInterval(timer);
        activePolls.delete(ledgerId);
    }
}
function watchPaymentLedger(row) {
    if (row.status !== "pending")
        return;
    if (row.payment_method === "manual_transfer")
        return;
    if (row.payment_method === "hosted_checkout" && !(0, paymentLedger_js_1.hostedCheckoutReadyForVerify)(row))
        return;
    if (activePolls.has(row.id))
        return;
    const timer = setInterval(async () => {
        try {
            const fresh = await (0, paymentLedger_js_1.getLedgerById)(row.id);
            if (!fresh || fresh.status !== "pending") {
                stopPolling(row.id);
                return;
            }
            const outcome = await (0, paymentLedger_js_1.verifyAndProcessLedger)(fresh);
            if (outcome !== "pending") {
                stopPolling(row.id);
            }
        }
        catch (error) {
            logger_js_1.logger.warn(`Poll error for ledger ${row.id}`, error);
        }
    }, POLL_INTERVAL_MS);
    activePolls.set(row.id, timer);
}
async function resumeActivePolls() {
    try {
        const pending = await (0, paymentLedger_js_1.listPendingLedgers)(200);
        for (const row of pending) {
            try {
                if (new Date(row.expires_at).getTime() <= Date.now()) {
                    await (0, paymentLedger_js_1.verifyAndProcessLedger)(row);
                    continue;
                }
                watchPaymentLedger(row);
            }
            catch (error) {
                logger_js_1.logger.warn(`Poll resume failed for ledger ${row.id}`, error);
            }
        }
    }
    catch (error) {
        logger_js_1.logger.warn("Payment poller could not reach database - will retry", error);
    }
}
