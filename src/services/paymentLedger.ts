import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { writeAuditLog } from "./audit.js";
import { emailApplicationPaidAdmin } from "./applicationEmails.js";
import { emailContextFromRow, loadApplication, recordApplicationEvent } from "./applications.js";
import { paychangu, PayChanguClient } from "./paychangu/client.js";
import type { PayChanguMethod } from "./paychangu/types.js";

export type PaymentMethodKind = PayChanguMethod | "travel_credit";

export type PaymentLedgerRow = RowDataPacket & {
  id: string;
  user_id: string;
  order_type: string;
  order_id: string;
  charge_id: string;
  payment_method: PaymentMethodKind;
  amount_mwk: number;
  payment_amount: number | null;
  currency: string;
  display_currency: string | null;
  status: "pending" | "completed" | "failed" | "expired";
  order_snapshot: string | Record<string, unknown>;
  paychangu_ref_id: string | null;
  paychangu_status: string | null;
  provider_response: string | Record<string, unknown> | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  bank_expires_at: Date | null;
  card_requires_3ds: number;
  card_3ds_url: string | null;
  mobile_number: string | null;
  mobile_operator_ref_id: string | null;
  mobile_operator_name: string | null;
  verification_window_minutes: number;
  expires_at: Date;
  completed_at: Date | null;
  order_fulfilled_at: Date | null;
  last_verified_at: Date | null;
  verification_attempts: number;
  failure_reason: string | null;
  created_at: Date;
};

const WINDOW_MINUTES: Record<PaymentMethodKind, number> = {
  mobile_money: 5,
  bank: 10,
  card: 5,
  hosted_checkout: 15,
  travel_credit: 0,
};

export function generateChargeId() {
  return `BZ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function mapLedgerPublic(row: PaymentLedgerRow) {
  const snapshot =
    typeof row.order_snapshot === "string" ? JSON.parse(row.order_snapshot) : row.order_snapshot;
  const providerRaw =
    typeof row.provider_response === "string"
      ? JSON.parse(row.provider_response)
      : row.provider_response;
  const checkoutUrl =
    providerRaw && typeof providerRaw === "object"
      ? ((providerRaw as { checkout_url?: string }).checkout_url ??
        (providerRaw as { data?: { checkout_url?: string } }).data?.checkout_url ??
        null)
      : null;

  return {
    id: row.id,
    chargeId: row.charge_id,
    paymentMethod: row.payment_method,
    amountMwk: Number(row.amount_mwk),
    paymentAmount: row.payment_amount != null ? Number(row.payment_amount) : Number(row.amount_mwk),
    currency: row.currency,
    displayCurrency: row.display_currency ?? row.currency,
    status: row.status,
    orderType: row.order_type,
    orderId: row.order_id,
    orderSnapshot: snapshot,
    paychanguStatus: row.paychangu_status,
    bankDetails:
      row.bank_account_number
        ? {
            bankName: row.bank_name,
            accountNumber: row.bank_account_number,
            accountName: row.bank_account_name,
            expiresAt: row.bank_expires_at ? new Date(row.bank_expires_at).toISOString() : null,
          }
        : null,
    card3ds:
      row.card_requires_3ds || row.card_3ds_url
        ? { requires3ds: Boolean(row.card_requires_3ds), authUrl: row.card_3ds_url }
        : null,
    mobileNumber: row.mobile_number,
    mobileOperatorName: row.mobile_operator_name,
    checkoutUrl,
    expiresAt: new Date(row.expires_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    orderFulfilled: Boolean(row.order_fulfilled_at),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function hostedCheckoutReadyForVerify(row: PaymentLedgerRow) {
  if (row.payment_method !== "hosted_checkout") return true;
  return row.paychangu_status === "checkout_returned";
}

export async function markHostedCheckoutReturned(row: PaymentLedgerRow, redirectStatus?: string | null) {
  const providerRaw =
    typeof row.provider_response === "string"
      ? JSON.parse(row.provider_response)
      : (row.provider_response ?? {});
  const merged = {
    ...(providerRaw && typeof providerRaw === "object" ? providerRaw : {}),
    checkout_returned: true,
    redirect_status: redirectStatus ?? null,
    returned_at: new Date().toISOString(),
  };

  await pool.execute(
    `UPDATE payment_ledger SET
      paychangu_status = 'checkout_returned',
      provider_response = :providerResponse,
      last_verified_at = UTC_TIMESTAMP()
     WHERE id = :id AND status = 'pending'`,
    { id: row.id, providerResponse: JSON.stringify(merged) },
  );
}

export async function processHostedCheckoutReturn(row: PaymentLedgerRow, redirectStatus?: string | null) {
  await markHostedCheckoutReturned(row, redirectStatus);
  const refreshed = await getLedgerById(row.id, row.user_id);
  if (!refreshed) {
    return { outcome: "not_found" as const, row };
  }

  const outcome = await verifyAndProcessLedger(
    { ...refreshed, paychangu_status: "checkout_returned" },
    { forceHostedVerify: true },
  );

  const final = (await getLedgerById(row.id, row.user_id)) ?? refreshed;
  return { outcome, row: final };
}

export async function getLedgerById(id: string, userId?: string) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    userId
      ? `SELECT * FROM payment_ledger WHERE id = :id AND user_id = :userId`
      : `SELECT * FROM payment_ledger WHERE id = :id`,
    userId ? { id, userId } : { id },
  );
  return rows[0] ?? null;
}

export async function getLedgerByChargeId(chargeId: string, userId?: string) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    userId
      ? `SELECT * FROM payment_ledger WHERE charge_id = :chargeId AND user_id = :userId ORDER BY created_at DESC LIMIT 1`
      : `SELECT * FROM payment_ledger WHERE charge_id = :chargeId ORDER BY created_at DESC LIMIT 1`,
    userId ? { chargeId, userId } : { chargeId },
  );
  return rows[0] ?? null;
}

export async function expirePendingLedgersForOrder(orderType: string, orderId: string) {
  await pool.execute(
    `UPDATE payment_ledger SET status = 'expired', last_verified_at = UTC_TIMESTAMP()
     WHERE order_type = :orderType AND order_id = :orderId AND status = 'pending'`,
    { orderType, orderId },
  );
}

export async function getActiveLedgerForOrder(orderType: string, orderId: string, userId: string) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger
     WHERE order_type = :orderType AND order_id = :orderId AND user_id = :userId
       AND status = 'pending' AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC LIMIT 1`,
    { orderType, orderId, userId },
  );
  return rows[0] ?? null;
}

export async function createLedgerEntry(input: {
  userId: string;
  orderType: string;
  orderId: string;
  chargeId: string;
  paymentMethod: PaymentMethodKind;
  amountMwk: number;
  paymentAmount?: number;
  currency?: string;
  displayCurrency?: string;
  orderSnapshot: Record<string, unknown>;
  paychanguRefId?: string;
  paychanguStatus?: string;
  providerResponse?: unknown;
  bankDetails?: { bankName: string; accountNumber: string; accountName: string; expiresAt: Date | null };
  card3ds?: { requires3ds: boolean; authUrl: string | null };
  mobileNumber?: string;
  mobileOperatorRefId?: string;
  mobileOperatorName?: string;
}) {
  const id = uuid();
  const windowMinutes = WINDOW_MINUTES[input.paymentMethod];
  const expiresAt = new Date(Date.now() + windowMinutes * 60 * 1000);
  const currency = input.currency ?? "MWK";
  const paymentAmount = input.paymentAmount ?? input.amountMwk;
  const displayCurrency = input.displayCurrency ?? currency;

  await pool.execute(
    `INSERT INTO payment_ledger (
      id, user_id, order_type, order_id, charge_id, payment_method,
      amount_mwk, payment_amount, currency, display_currency, status, order_snapshot,
      paychangu_ref_id, paychangu_status, provider_response,
      bank_name, bank_account_number, bank_account_name, bank_expires_at,
      card_requires_3ds, card_3ds_url,
      mobile_number, mobile_operator_ref_id, mobile_operator_name,
      verification_window_minutes, expires_at
    ) VALUES (
      :id, :userId, :orderType, :orderId, :chargeId, :paymentMethod,
      :amountMwk, :paymentAmount, :currency, :displayCurrency, 'pending', :orderSnapshot,
      :paychanguRefId, :paychanguStatus, :providerResponse,
      :bankName, :bankAccountNumber, :bankAccountName, :bankExpiresAt,
      :cardRequires3ds, :card3dsUrl,
      :mobileNumber, :mobileOperatorRefId, :mobileOperatorName,
      :windowMinutes, :expiresAt
    )`,
    {
      id,
      userId: input.userId,
      orderType: input.orderType,
      orderId: input.orderId,
      chargeId: input.chargeId,
      paymentMethod: input.paymentMethod,
      amountMwk: input.amountMwk,
      paymentAmount,
      currency,
      displayCurrency,
      orderSnapshot: JSON.stringify(input.orderSnapshot),
      paychanguRefId: input.paychanguRefId ?? null,
      paychanguStatus: input.paychanguStatus ?? "pending",
      providerResponse: input.providerResponse ? JSON.stringify(input.providerResponse) : null,
      bankName: input.bankDetails?.bankName ?? null,
      bankAccountNumber: input.bankDetails?.accountNumber ?? null,
      bankAccountName: input.bankDetails?.accountName ?? null,
      bankExpiresAt: input.bankDetails?.expiresAt ?? null,
      cardRequires3ds: input.card3ds?.requires3ds ? 1 : 0,
      card3dsUrl: input.card3ds?.authUrl ?? null,
      mobileNumber: input.mobileNumber ?? null,
      mobileOperatorRefId: input.mobileOperatorRefId ?? null,
      mobileOperatorName: input.mobileOperatorName ?? null,
      windowMinutes,
      expiresAt,
    },
  );

  const row = await getLedgerById(id);
  if (!row) throw new Error("Failed to create payment ledger entry");
  return row;
}

export async function markLedgerCompleted(row: PaymentLedgerRow, verifyResult: { status: string; refId?: string; raw: unknown }) {
  await pool.execute(
    `UPDATE payment_ledger SET
      status = 'completed',
      paychangu_status = :paychanguStatus,
      paychangu_ref_id = COALESCE(:refId, paychangu_ref_id),
      provider_response = :providerResponse,
      completed_at = UTC_TIMESTAMP(),
      last_verified_at = UTC_TIMESTAMP(),
      verification_attempts = verification_attempts + 1
     WHERE id = :id AND status = 'pending'`,
    {
      id: row.id,
      paychanguStatus: verifyResult.status,
      refId: verifyResult.refId ?? null,
      providerResponse: JSON.stringify(verifyResult.raw),
    },
  );
}

export async function markLedgerFailed(row: PaymentLedgerRow, reason: string, paychanguStatus?: string) {
  await pool.execute(
    `UPDATE payment_ledger SET
      status = 'failed',
      failure_reason = :reason,
      paychangu_status = COALESCE(:paychanguStatus, paychangu_status),
      last_verified_at = UTC_TIMESTAMP(),
      verification_attempts = verification_attempts + 1
     WHERE id = :id AND status = 'pending'`,
    { id: row.id, reason, paychanguStatus: paychanguStatus ?? null },
  );
}

export async function markLedgerExpired(row: PaymentLedgerRow) {
  await pool.execute(
    `UPDATE payment_ledger SET status = 'expired', last_verified_at = UTC_TIMESTAMP()
     WHERE id = :id AND status = 'pending'`,
    { id: row.id },
  );
}

export async function touchVerification(row: PaymentLedgerRow, paychanguStatus: string, raw: unknown) {
  await pool.execute(
    `UPDATE payment_ledger SET
      paychangu_status = :paychanguStatus,
      provider_response = :providerResponse,
      last_verified_at = UTC_TIMESTAMP(),
      verification_attempts = verification_attempts + 1
     WHERE id = :id`,
    {
      id: row.id,
      paychanguStatus,
      providerResponse: JSON.stringify(raw),
    },
  );
}

export async function getActiveCreditPurchaseLedger(userId: string) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger
     WHERE order_type = 'travel_credit_purchase' AND user_id = :userId
       AND status = 'pending' AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC LIMIT 1`,
    { userId },
  );
  return rows[0] ?? null;
}

export async function fulfillTravelCreditPurchaseInTransaction(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  ledger: PaymentLedgerRow,
) {
  const [existing] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM travel_credit_transactions WHERE payment_ledger_id = :ledgerId LIMIT 1`,
    { ledgerId: ledger.id },
  );
  if (existing[0]) return;

  const userId = ledger.user_id;
  const amountMwk = Number(ledger.amount_mwk);
  if (amountMwk <= 0) throw new Error("Invalid travel credit purchase amount");

  await conn.execute(`INSERT IGNORE INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, {
    userId,
  });

  const [creditRows] = await conn.execute<RowDataPacket[]>(
    `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId FOR UPDATE`,
    { userId },
  );
  const current = Number(creditRows[0]?.balance_mwk ?? 0);
  const next = current + amountMwk;

  await conn.execute(`UPDATE travel_credit SET balance_mwk = :balance WHERE user_id = :userId`, {
    userId,
    balance: next,
  });

  const txId = uuid();
  await conn.execute(
    `INSERT INTO travel_credit_transactions
     (id, user_id, entry_type, amount_mwk, balance_after, description, reference, payment_ledger_id, created_by)
     VALUES (:id, :userId, 'credit', :amount, :balanceAfter, :description, :reference, :ledgerId, :userId)`,
    {
      id: txId,
      userId,
      amount: amountMwk,
      balanceAfter: next,
      description: `Travel credit purchase via PayChangu (${ledger.currency})`,
      reference: ledger.charge_id,
      ledgerId: ledger.id,
    },
  );

  const financeId = uuid();
  await conn.execute(
    `INSERT INTO finance_ledger (id, user_id, entry_type, amount_mwk, description, reference, created_by)
     VALUES (:id, :userId, 'payment', :amount, :description, :reference, :userId)`,
    {
      id: financeId,
      userId,
      amount: amountMwk,
      description: `Travel credit purchase · ${ledger.charge_id}`,
      reference: ledger.charge_id,
    },
  );

  await writeAuditLog({
    userId,
    action: "travel_credit.purchased",
    metadata: { amountMwk, ledgerId: ledger.id, chargeId: ledger.charge_id },
  });
}

export async function fulfillOrderForLedger(ledgerId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  let postCommitEmail: (() => Promise<void>) | null = null;

  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<PaymentLedgerRow[]>(
      `SELECT * FROM payment_ledger WHERE id = :id FOR UPDATE`,
      { id: ledgerId },
    );
    const ledger = rows[0];
    if (!ledger || ledger.status !== "completed") {
      await conn.rollback();
      return false;
    }
    if (ledger.order_fulfilled_at) {
      await conn.commit();
      return true;
    }

    if (ledger.order_type === "flight_application") {
      postCommitEmail = await fulfillFlightApplicationInTransaction(conn, ledger);
    } else if (ledger.order_type === "travel_credit_purchase") {
      await fulfillTravelCreditPurchaseInTransaction(conn, ledger);
    }

    await conn.execute(
      `UPDATE payment_ledger SET order_fulfilled_at = UTC_TIMESTAMP() WHERE id = :id`,
      { id: ledgerId },
    );

    await conn.commit();
    if (postCommitEmail) await postCommitEmail();
    logger.info(`Order fulfilled for payment ledger ${ledgerId}`);
    return true;
  } catch (error) {
    await conn.rollback();
    logger.error(`Failed to fulfill order for ledger ${ledgerId}`, error);
    throw error;
  } finally {
    conn.release();
  }
}

export async function fulfillFlightApplicationInTransaction(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  ledger: PaymentLedgerRow,
): Promise<(() => Promise<void>) | null> {
  const applicationId = ledger.order_id;

  const [apps] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM flight_applications WHERE id = :id FOR UPDATE`,
    { id: applicationId },
  );
  const app = apps[0];
  if (!app) throw new Error("Application not found for payment");

  if (app.status === "paid" || app.status === "purchasing" || app.status === "completed") {
    return null;
  }

  if (app.status !== "awaiting_payment") {
    throw new Error(`Application ${applicationId} is not awaiting payment (${app.status})`);
  }

  await conn.execute(
    `UPDATE flight_applications SET
      status = 'paid',
      paid_at = UTC_TIMESTAMP(),
      payment_ledger_id = :ledgerId,
      paid_currency = :paidCurrency,
      paid_amount = :paidAmount,
      customer_display_currency = :displayCurrency
     WHERE id = :id`,
    {
      id: applicationId,
      ledgerId: ledger.id,
      paidCurrency: ledger.currency,
      paidAmount: ledger.payment_amount != null ? Number(ledger.payment_amount) : Number(ledger.amount_mwk),
      displayCurrency: ledger.display_currency ?? ledger.currency,
    },
  );

  const financeId = uuid();
  const snapshot =
    typeof ledger.order_snapshot === "string"
      ? JSON.parse(ledger.order_snapshot)
      : ledger.order_snapshot;
  const referenceNumber = (snapshot.referenceNumber as string) ?? applicationId;
  const paymentLabel =
    ledger.payment_method === "travel_credit"
      ? "Travel credit"
      : `PayChangu ${ledger.payment_method}`;

  await conn.execute(
    `INSERT INTO finance_ledger (id, user_id, entry_type, amount_mwk, description, reference, created_by)
     VALUES (:id, :userId, 'payment', :amount, :description, :reference, :userId)`,
    {
      id: financeId,
      userId: ledger.user_id,
      amount: ledger.amount_mwk,
      description: `${paymentLabel} · ${referenceNumber}`,
      reference: ledger.charge_id,
    },
  );

  await recordApplicationEvent(
    applicationId,
    "payment_received",
    ledger.payment_method === "travel_credit"
      ? `Payment received via travel credit. Ref ${ledger.charge_id}.`
      : `Payment received via PayChangu (${ledger.payment_method}). Charge ${ledger.charge_id}.`,
    conn,
  );

  const userId = ledger.user_id;
  const amountMwk = Number(ledger.amount_mwk);

  return async () => {
    const loaded = await loadApplication(applicationId);
    if (!loaded) return;
    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: userId },
    );
    const user = users[0];
    if (!user) return;
    const ctx = emailContextFromRow(
      loaded.raw,
      `${user.first_name} ${user.last_name}`,
      user.email as string,
    );
    await emailApplicationPaidAdmin({ ...ctx, totalMwk: amountMwk });
  };
}

export async function verifyAndProcessLedger(
  row: PaymentLedgerRow,
  options?: { forceHostedVerify?: boolean },
): Promise<"completed" | "pending" | "failed" | "expired"> {
  if (row.status !== "pending") return row.status;

  if (row.payment_method === "travel_credit") {
    return row.status;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await markLedgerExpired(row);
    return "expired";
  }

  if (
    row.payment_method === "hosted_checkout" &&
    !options?.forceHostedVerify &&
    !hostedCheckoutReadyForVerify(row)
  ) {
    return "pending";
  }

  try {
    const result = await paychangu.verify(row.payment_method as Exclude<PaymentMethodKind, "travel_credit">, row.charge_id);
    const parsed = PayChanguClient.parseStatus(result.status);

    if (result.status === "awaiting_checkout") {
      return "pending";
    }

    if (result.success || parsed.isSuccess) {
      await markLedgerCompleted(row, result);
      await fulfillOrderForLedger(row.id);
      return "completed";
    }

    if (parsed.isFailed) {
      await markLedgerFailed(row, `PayChangu reported ${result.status}`, result.status);
      return "failed";
    }

    await touchVerification(row, result.status, result.raw);
    return "pending";
  } catch (error) {
    const message = (error as Error).message;
    if (row.payment_method === "hosted_checkout" && /not created|not found/i.test(message)) {
      return "pending";
    }
    logger.warn(`PayChangu verify failed for ${row.charge_id}`, error);
    await touchVerification(row, "verify_error", { error: message });
    return "pending";
  }
}

export async function buildApplicationOrderSnapshot(applicationId: string, userId: string) {
  const loaded = await loadApplication(applicationId);
  if (!loaded || loaded.raw.user_id !== userId) {
    throw new Error("Application not found");
  }
  if (loaded.application.status !== "awaiting_payment") {
    throw new Error("Application is not awaiting payment");
  }

  return {
    applicationId,
    referenceNumber: loaded.application.referenceNumber,
    amountMwk: loaded.application.totalPriceMwk,
    originCode: loaded.application.originCode,
    destinationCode: loaded.application.destinationCode,
    originCity: loaded.application.originCity,
    destinationCity: loaded.application.destinationCity,
    departDate: loaded.application.quotedDepartDate ?? loaded.application.departDate,
    passengerCount: loaded.application.passengers.length,
    quotedAirline: loaded.application.quotedAirline,
    quotedFlightNumber: loaded.application.quotedFlightNumber,
  };
}

export async function listPendingLedgers(limit = 100) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger WHERE status = 'pending' ORDER BY created_at ASC LIMIT :limit`,
    { limit },
  );
  return rows;
}

export async function listCompletedUnfulfilledSince(since: Date) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger
     WHERE status = 'completed' AND order_fulfilled_at IS NULL AND completed_at >= :since
     ORDER BY completed_at ASC`,
    { since },
  );
  return rows;
}

export async function listAllPendingLedgers(limit = 500) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger WHERE status = 'pending' ORDER BY created_at ASC LIMIT :limit`,
    { limit },
  );
  return rows;
}

export async function listRecentlyCompletedLedgers(since: Date) {
  const [rows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger
     WHERE status = 'completed' AND completed_at >= :since
     ORDER BY completed_at ASC`,
    { since },
  );
  return rows;
}
