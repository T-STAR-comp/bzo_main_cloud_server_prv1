import { logger } from "../logger.js";
import {
  getLedgerById,
  hostedCheckoutReadyForVerify,
  listPendingLedgers,
  verifyAndProcessLedger,
  type PaymentLedgerRow,
} from "./paymentLedger.js";

const POLL_INTERVAL_MS = 12_000;
const activePolls = new Map<string, ReturnType<typeof setInterval>>();

export function startPaymentPoller() {
  void resumeActivePolls();

  setInterval(() => {
    void resumeActivePolls();
  }, 60_000);

  logger.info("Payment poller started (12s interval during verification windows)");
}

function stopPolling(ledgerId: string) {
  const timer = activePolls.get(ledgerId);
  if (timer) {
    clearInterval(timer);
    activePolls.delete(ledgerId);
  }
}

export function watchPaymentLedger(row: PaymentLedgerRow) {
  if (row.status !== "pending") return;
  if (row.payment_method === "hosted_checkout" && !hostedCheckoutReadyForVerify(row)) return;
  if (activePolls.has(row.id)) return;

  const timer = setInterval(async () => {
    try {
      const fresh = await getLedgerById(row.id);
      if (!fresh || fresh.status !== "pending") {
        stopPolling(row.id);
        return;
      }
      const outcome = await verifyAndProcessLedger(fresh);
      if (outcome !== "pending") {
        stopPolling(row.id);
      }
    } catch (error) {
      logger.warn(`Poll error for ledger ${row.id}`, error);
    }
  }, POLL_INTERVAL_MS);

  activePolls.set(row.id, timer);
}

async function resumeActivePolls() {
  try {
    const pending = await listPendingLedgers(200);
    for (const row of pending) {
      try {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          await verifyAndProcessLedger(row);
          continue;
        }
        watchPaymentLedger(row);
      } catch (error) {
        logger.warn(`Poll resume failed for ledger ${row.id}`, error);
      }
    }
  } catch (error) {
    logger.warn("Payment poller could not reach database — will retry", error);
  }
}
