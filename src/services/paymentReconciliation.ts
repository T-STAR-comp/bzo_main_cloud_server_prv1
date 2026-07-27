import { logger } from "../logger.js";
import {
  fulfillOrderForLedger,
  listAllPendingLedgers,
  listRecentlyCompletedLedgers,
  verifyAndProcessLedger,
} from "./paymentLedger.js";

const HOUR_MS = 60 * 60 * 1000;

export function startPaymentReconciliation() {
  setInterval(() => {
    void runHourlyReconciliation();
  }, HOUR_MS);

  setTimeout(() => {
    void runHourlyReconciliation();
  }, 15_000);

  logger.info("Payment reconciliation scheduled (hourly pending verify + completed order confirm)");
}

export async function runHourlyReconciliation() {
  try {
    logger.info("Running hourly payment ledger reconciliation…");

    const pending = await listAllPendingLedgers(500);
    for (const row of pending) {
      try {
        await verifyAndProcessLedger(row);
      } catch (error) {
        logger.warn(`Hourly verify failed for ledger ${row.id}`, error);
      }
    }

    const since = new Date(Date.now() - HOUR_MS);
    const completedRecent = await listRecentlyCompletedLedgers(since);
    for (const row of completedRecent) {
      if (row.order_fulfilled_at) {
        continue;
      }
      try {
        await fulfillOrderForLedger(row.id);
        logger.info(`Reconciliation fulfilled order for ledger ${row.id}`);
      } catch (error) {
        logger.error(`Reconciliation fulfillment failed for ledger ${row.id}`, error);
      }
    }

    logger.info(
      `Hourly reconciliation done — checked ${pending.length} pending, ${completedRecent.length} recent completed`,
    );
  } catch (error) {
    logger.warn("Hourly payment reconciliation skipped — database unavailable", error);
  }
}
