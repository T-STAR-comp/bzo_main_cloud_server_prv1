import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { AppError } from "../middleware/errorHandler.js";
import { writeAuditLog } from "./audit.js";
import {
  buildApplicationOrderSnapshot,
  fulfillFlightApplicationInTransaction,
  generateChargeId,
  getActiveLedgerForOrder,
  mapLedgerPublic,
  type PaymentLedgerRow,
} from "./paymentLedger.js";

type DbConn = Awaited<ReturnType<typeof pool.getConnection>>;

export type TravelCreditTransactionRow = {
  id: string;
  userId: string;
  entryType: "credit" | "debit" | "adjustment";
  amountMwk: number;
  balanceAfter: number;
  description: string;
  reference: string | null;
  applicationId: string | null;
  paymentLedgerId: string | null;
  createdBy: string | null;
  createdAt: string;
  userEmail?: string;
  userName?: string;
};

function mapTransaction(row: RowDataPacket): TravelCreditTransactionRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    entryType: row.entry_type as TravelCreditTransactionRow["entryType"],
    amountMwk: Number(row.amount_mwk),
    balanceAfter: Number(row.balance_after),
    description: row.description as string,
    reference: (row.reference as string | null) ?? null,
    applicationId: (row.application_id as string | null) ?? null,
    paymentLedgerId: (row.payment_ledger_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    userEmail: row.email as string | undefined,
    userName: row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
  };
}

async function ensureTravelCreditRow(conn: DbConn, userId: string) {
  await conn.execute(`INSERT IGNORE INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, { userId });
}

export async function getTravelCreditBalance(userId: string, conn?: DbConn): Promise<number> {
  if (conn) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`,
      { userId },
    );
    return Number(rows[0]?.balance_mwk ?? 0);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`,
    { userId },
  );
  return Number(rows[0]?.balance_mwk ?? 0);
}

export async function addTravelCredit(input: {
  userId: string;
  amountMwk: number;
  description: string;
  createdBy: string;
  reference?: string;
  entryType?: "credit" | "adjustment";
}) {
  if (input.amountMwk <= 0) throw new AppError(400, "Amount must be positive");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureTravelCreditRow(conn, input.userId);

    const [users] = await conn.execute<RowDataPacket[]>(`SELECT id FROM users WHERE id = :id`, {
      id: input.userId,
    });
    if (!users[0]) throw new AppError(404, "User not found");

    const [creditRows] = await conn.execute<RowDataPacket[]>(
      `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId FOR UPDATE`,
      { userId: input.userId },
    );
    const current = Number(creditRows[0]?.balance_mwk ?? 0);
    const next = current + input.amountMwk;

    await conn.execute(`UPDATE travel_credit SET balance_mwk = :balance WHERE user_id = :userId`, {
      userId: input.userId,
      balance: next,
    });

    const txId = uuid();
    const entryType = input.entryType ?? "credit";
    await conn.execute(
      `INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, created_by)
       VALUES (:id, :userId, :entryType, :amount, :balanceAfter, :description, :reference, :createdBy)`,
      {
        id: txId,
        userId: input.userId,
        entryType,
        amount: input.amountMwk,
        balanceAfter: next,
        description: input.description,
        reference: input.reference ?? null,
        createdBy: input.createdBy,
      },
    );

    const financeId = uuid();
    await conn.execute(
      `INSERT INTO finance_ledger (id, user_id, entry_type, amount_mwk, description, reference, created_by)
       VALUES (:id, :userId, 'credit', :amount, :description, :reference, :createdBy)`,
      {
        id: financeId,
        userId: input.userId,
        amount: input.amountMwk,
        description: input.description,
        reference: input.reference ?? txId,
        createdBy: input.createdBy,
      },
    );

    await conn.commit();

    await writeAuditLog({
      userId: input.userId,
      action: "travel_credit.added",
      metadata: { amountMwk: input.amountMwk, txId, createdBy: input.createdBy },
    });

    return { transactionId: txId, balanceMwk: next };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function listTravelCreditBalances() {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.status,
            COALESCE(tc.balance_mwk, 0) AS balance_mwk,
            tc.updated_at
     FROM users u
     LEFT JOIN travel_credit tc ON tc.user_id = u.id
     WHERE u.role = 'user'
     ORDER BY tc.balance_mwk DESC, u.created_at DESC
     LIMIT 500`,
  );

  return rows.map((row) => ({
    userId: row.id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    status: row.status as string,
    balanceMwk: Number(row.balance_mwk ?? 0),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }));
}

export async function listTravelCreditTransactions(limit = 100, userId?: string) {
  let sql = `
    SELECT t.*, u.email, u.first_name, u.last_name
    FROM travel_credit_transactions t
    JOIN users u ON u.id = t.user_id
    WHERE 1=1`;
  const params: Record<string, string | number> = { limit };

  if (userId) {
    sql += ` AND t.user_id = :userId`;
    params.userId = userId;
  }

  sql += ` ORDER BY t.created_at DESC LIMIT :limit`;

  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows.map(mapTransaction);
}

export async function searchTravelCreditRecipients(fromUserId: string, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, email, first_name, last_name FROM users
     WHERE role = 'user' AND status = 'active' AND id != :fromUserId
     AND (LOWER(email) LIKE :emailQ OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE :nameQ)
     ORDER BY
       CASE WHEN LOWER(email) = :exact THEN 0 WHEN LOWER(email) LIKE :prefix THEN 1 ELSE 2 END,
       email ASC
     LIMIT 8`,
    {
      fromUserId,
      emailQ: `%${q}%`,
      nameQ: `%${q}%`,
      exact: q,
      prefix: `${q}%`,
    },
  );

  return rows.map((row) => ({
    id: row.id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
  }));
}

export async function shareTravelCredit(input: {
  fromUserId: string;
  toUserId: string;
  amountMwk: number;
  note?: string;
}) {
  if (input.amountMwk <= 0) throw new AppError(400, "Amount must be positive");
  if (input.fromUserId === input.toUserId) throw new AppError(400, "You cannot share credits with yourself");

  const conn = await pool.getConnection();
  const transferRef = uuid();

  try {
    await conn.beginTransaction();

    const [recipients] = await conn.execute<RowDataPacket[]>(
      `SELECT id, email, first_name, last_name FROM users
       WHERE id = :id AND role = 'user' AND status = 'active'`,
      { id: input.toUserId },
    );
    const recipient = recipients[0];
    if (!recipient) throw new AppError(404, "Recipient not found");

    const [senders] = await conn.execute<RowDataPacket[]>(
      `SELECT first_name, last_name FROM users WHERE id = :id`,
      { id: input.fromUserId },
    );
    const sender = senders[0];
    if (!sender) throw new AppError(404, "Account not found");

    await ensureTravelCreditRow(conn, input.fromUserId);
    await ensureTravelCreditRow(conn, input.toUserId);

    const firstLock = input.fromUserId < input.toUserId ? input.fromUserId : input.toUserId;
    const secondLock = input.fromUserId < input.toUserId ? input.toUserId : input.fromUserId;

    await conn.execute(`SELECT user_id FROM travel_credit WHERE user_id = :userId FOR UPDATE`, {
      userId: firstLock,
    });
    await conn.execute(`SELECT user_id FROM travel_credit WHERE user_id = :userId FOR UPDATE`, {
      userId: secondLock,
    });

    const [senderCredit] = await conn.execute<RowDataPacket[]>(
      `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`,
      { userId: input.fromUserId },
    );
    const senderBalance = Number(senderCredit[0]?.balance_mwk ?? 0);
    if (senderBalance < input.amountMwk) {
      throw new AppError(
        400,
        `Insufficient travel credit. You have MWK ${senderBalance.toLocaleString()} but tried to share MWK ${input.amountMwk.toLocaleString()}.`,
      );
    }

    const [recipientCredit] = await conn.execute<RowDataPacket[]>(
      `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`,
      { userId: input.toUserId },
    );
    const recipientBalance = Number(recipientCredit[0]?.balance_mwk ?? 0);

    const senderNext = senderBalance - input.amountMwk;
    const recipientNext = recipientBalance + input.amountMwk;

    await conn.execute(`UPDATE travel_credit SET balance_mwk = :balance WHERE user_id = :userId`, {
      userId: input.fromUserId,
      balance: senderNext,
    });
    await conn.execute(`UPDATE travel_credit SET balance_mwk = :balance WHERE user_id = :userId`, {
      userId: input.toUserId,
      balance: recipientNext,
    });

    const senderName = `${sender.first_name} ${sender.last_name}`;
    const recipientName = `${recipient.first_name} ${recipient.last_name}`;
    const noteSuffix = input.note?.trim() ? ` — ${input.note.trim()}` : "";

    const debitId = uuid();
    const creditId = uuid();

    await conn.execute(
      `INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, created_by)
       VALUES (:id, :userId, 'debit', :amount, :balanceAfter, :description, :reference, :createdBy)`,
      {
        id: debitId,
        userId: input.fromUserId,
        amount: input.amountMwk,
        balanceAfter: senderNext,
        description: `Shared with ${recipientName}${noteSuffix}`,
        reference: transferRef,
        createdBy: input.fromUserId,
      },
    );

    await conn.execute(
      `INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, created_by)
       VALUES (:id, :userId, 'credit', :amount, :balanceAfter, :description, :reference, :createdBy)`,
      {
        id: creditId,
        userId: input.toUserId,
        amount: input.amountMwk,
        balanceAfter: recipientNext,
        description: `Received from ${senderName}${noteSuffix}`,
        reference: transferRef,
        createdBy: input.fromUserId,
      },
    );

    await conn.commit();

    await writeAuditLog({
      userId: input.fromUserId,
      action: "travel_credit.shared",
      metadata: {
        toUserId: input.toUserId,
        amountMwk: input.amountMwk,
        transferRef,
      },
    });

    return {
      transferRef,
      balanceMwk: senderNext,
      recipient: {
        id: recipient.id as string,
        email: recipient.email as string,
        firstName: recipient.first_name as string,
        lastName: recipient.last_name as string,
      },
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function addTravelCreditToAllUsers(input: {
  amountMwk: number;
  description: string;
  createdBy: string;
  reference?: string;
}) {
  if (input.amountMwk <= 0) throw new AppError(400, "Amount must be positive");

  const [users] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE role = 'user' AND status = 'active'`,
  );

  let usersCredited = 0;
  for (const user of users) {
    await addTravelCredit({
      userId: user.id as string,
      amountMwk: input.amountMwk,
      description: input.description,
      reference: input.reference,
      createdBy: input.createdBy,
    });
    usersCredited += 1;
  }

  await writeAuditLog({
    userId: input.createdBy,
    action: "travel_credit.bulk_issued",
    metadata: {
      amountMwk: input.amountMwk,
      usersCredited,
      description: input.description,
    },
  });

  return {
    usersCredited,
    totalIssuedMwk: input.amountMwk * usersCredited,
  };
}

export async function payApplicationWithTravelCredit(
  userId: string,
  applicationId: string,
  displayCurrency: string,
) {
  const existing = await getActiveLedgerForOrder("flight_application", applicationId, userId);
  if (existing) {
    throw new AppError(409, "A payment is already in progress for this application. Cancel or complete it first.");
  }

  const snapshot = await buildApplicationOrderSnapshot(applicationId, userId);
  const amountMwk = Number(snapshot.amountMwk);
  if (amountMwk <= 0) throw new AppError(400, "Invalid payment amount");

  const display = displayCurrency.toUpperCase();
  const chargeId = generateChargeId();
  const ledgerId = uuid();
  const conn = await pool.getConnection();
  let postCommitEmail: (() => Promise<void>) | null = null;

  try {
    await conn.beginTransaction();
    await ensureTravelCreditRow(conn, userId);

    const [creditRows] = await conn.execute<RowDataPacket[]>(
      `SELECT balance_mwk FROM travel_credit WHERE user_id = :userId FOR UPDATE`,
      { userId },
    );
    const balance = Number(creditRows[0]?.balance_mwk ?? 0);
    if (balance < amountMwk) {
      throw new AppError(400, `Insufficient travel credit. You have MWK ${balance.toLocaleString()} but need MWK ${amountMwk.toLocaleString()}.`);
    }

    const nextBalance = balance - amountMwk;
    await conn.execute(`UPDATE travel_credit SET balance_mwk = :balance WHERE user_id = :userId`, {
      userId,
      balance: nextBalance,
    });

    const enrichedSnapshot = {
      ...snapshot,
      displayCurrency: display,
      paymentCurrency: "MWK",
      paymentAmount: amountMwk,
    };

    const now = new Date();
    await conn.execute(
      `INSERT INTO payment_ledger (
        id, user_id, order_type, order_id, charge_id, payment_method,
        amount_mwk, payment_amount, currency, display_currency, status, order_snapshot,
        paychangu_status, verification_window_minutes, expires_at, completed_at, order_fulfilled_at
      ) VALUES (
        :id, :userId, 'flight_application', :orderId, :chargeId, 'travel_credit',
        :amountMwk, :amountMwk, 'MWK', :displayCurrency, 'completed', :orderSnapshot,
        'completed', 0, :now, :now, NULL
      )`,
      {
        id: ledgerId,
        userId,
        orderId: applicationId,
        chargeId,
        amountMwk,
        displayCurrency: display,
        orderSnapshot: JSON.stringify(enrichedSnapshot),
        now,
      },
    );

    const txId = uuid();
    await conn.execute(
      `INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, application_id, payment_ledger_id, created_by)
       VALUES (:id, :userId, 'debit', :amount, :balanceAfter, :description, :reference, :applicationId, :ledgerId, :userId)`,
      {
        id: txId,
        userId,
        amount: amountMwk,
        balanceAfter: nextBalance,
        description: `Payment for application ${snapshot.referenceNumber}`,
        reference: chargeId,
        applicationId,
        ledgerId,
      },
    );

    const [ledgerRows] = await conn.execute<PaymentLedgerRow[]>(
      `SELECT * FROM payment_ledger WHERE id = :id`,
      { id: ledgerId },
    );
    const ledger = ledgerRows[0];
    if (!ledger) throw new Error("Failed to create payment ledger entry");

    postCommitEmail = await fulfillFlightApplicationInTransaction(conn, ledger);

    await conn.execute(
      `UPDATE payment_ledger SET order_fulfilled_at = UTC_TIMESTAMP() WHERE id = :id`,
      { id: ledgerId },
    );

    await conn.commit();

    if (postCommitEmail) await postCommitEmail();

    await writeAuditLog({
      userId,
      action: "travel_credit.payment",
      metadata: { applicationId, amountMwk, ledgerId, chargeId },
    });

    const [finalLedgerRows] = await pool.execute<PaymentLedgerRow[]>(
      `SELECT * FROM payment_ledger WHERE id = :id`,
      { id: ledgerId },
    );

    return {
      payment: mapLedgerPublic(finalLedgerRows[0]!),
      balanceMwk: nextBalance,
      message: "Payment completed with travel credit.",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
