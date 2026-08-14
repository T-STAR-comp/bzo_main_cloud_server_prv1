"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTravelCreditBalance = getTravelCreditBalance;
exports.addTravelCredit = addTravelCredit;
exports.listTravelCreditBalances = listTravelCreditBalances;
exports.listTravelCreditTransactions = listTravelCreditTransactions;
exports.searchTravelCreditRecipients = searchTravelCreditRecipients;
exports.shareTravelCredit = shareTravelCredit;
exports.addTravelCreditToAllUsers = addTravelCreditToAllUsers;
exports.payApplicationWithTravelCredit = payApplicationWithTravelCredit;
const uuid_1 = require("uuid");
const pool_js_1 = require("../db/pool.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const audit_js_1 = require("./audit.js");
const paymentLedger_js_1 = require("./paymentLedger.js");
function mapTransaction(row) {
    return {
        id: row.id,
        userId: row.user_id,
        entryType: row.entry_type,
        amountMwk: Number(row.amount_mwk),
        balanceAfter: Number(row.balance_after),
        description: row.description,
        reference: row.reference ?? null,
        applicationId: row.application_id ?? null,
        paymentLedgerId: row.payment_ledger_id ?? null,
        createdBy: row.created_by ?? null,
        createdAt: new Date(row.created_at).toISOString(),
        userEmail: row.email,
        userName: row.first_name ? `${row.first_name} ${row.last_name}` : undefined,
    };
}
async function ensureTravelCreditRow(conn, userId) {
    await conn.execute(`INSERT IGNORE INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, { userId });
}
async function getTravelCreditBalance(userId, conn) {
    if (conn) {
        const [rows] = await conn.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`, { userId });
        return Number(rows[0]?.balance_mwk ?? 0);
    }
    const [rows] = await pool_js_1.pool.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`, { userId });
    return Number(rows[0]?.balance_mwk ?? 0);
}
async function addTravelCredit(input) {
    if (input.amountMwk <= 0)
        throw new errorHandler_js_1.AppError(400, "Amount must be positive");
    const conn = await pool_js_1.pool.getConnection();
    try {
        await conn.beginTransaction();
        await ensureTravelCreditRow(conn, input.userId);
        const [users] = await conn.execute(`SELECT id FROM users WHERE id = :id`, {
            id: input.userId,
        });
        if (!users[0])
            throw new errorHandler_js_1.AppError(404, "User not found");
        const [creditRows] = await conn.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId FOR UPDATE`, { userId: input.userId });
        const current = Number(creditRows[0]?.balance_mwk ?? 0);
        const next = current + input.amountMwk;
        await conn.execute(`UPDATE travel_credit SET balance_mwk = :balance WHERE user_id = :userId`, {
            userId: input.userId,
            balance: next,
        });
        const txId = (0, uuid_1.v4)();
        const entryType = input.entryType ?? "credit";
        await conn.execute(`INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, created_by)
       VALUES (:id, :userId, :entryType, :amount, :balanceAfter, :description, :reference, :createdBy)`, {
            id: txId,
            userId: input.userId,
            entryType,
            amount: input.amountMwk,
            balanceAfter: next,
            description: input.description,
            reference: input.reference ?? null,
            createdBy: input.createdBy,
        });
        const financeId = (0, uuid_1.v4)();
        await conn.execute(`INSERT INTO finance_ledger (id, user_id, entry_type, amount_mwk, description, reference, created_by)
       VALUES (:id, :userId, 'credit', :amount, :description, :reference, :createdBy)`, {
            id: financeId,
            userId: input.userId,
            amount: input.amountMwk,
            description: input.description,
            reference: input.reference ?? txId,
            createdBy: input.createdBy,
        });
        await conn.commit();
        await (0, audit_js_1.writeAuditLog)({
            userId: input.userId,
            action: "travel_credit.added",
            metadata: { amountMwk: input.amountMwk, txId, createdBy: input.createdBy },
        });
        return { transactionId: txId, balanceMwk: next };
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function listTravelCreditBalances() {
    const [rows] = await pool_js_1.pool.execute(`SELECT u.id, u.email, u.first_name, u.last_name, u.status,
            COALESCE(tc.balance_mwk, 0) AS balance_mwk,
            tc.updated_at
     FROM users u
     LEFT JOIN travel_credit tc ON tc.user_id = u.id
     WHERE u.role = 'user'
     ORDER BY tc.balance_mwk DESC, u.created_at DESC
     LIMIT 500`);
    return rows.map((row) => ({
        userId: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        status: row.status,
        balanceMwk: Number(row.balance_mwk ?? 0),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }));
}
async function listTravelCreditTransactions(limit = 100, userId) {
    let sql = `
    SELECT t.*, u.email, u.first_name, u.last_name
    FROM travel_credit_transactions t
    JOIN users u ON u.id = t.user_id
    WHERE 1=1`;
    const params = { limit };
    if (userId) {
        sql += ` AND t.user_id = :userId`;
        params.userId = userId;
    }
    sql += ` ORDER BY t.created_at DESC LIMIT :limit`;
    const [rows] = await pool_js_1.pool.execute(sql, params);
    return rows.map(mapTransaction);
}
async function searchTravelCreditRecipients(fromUserId, query) {
    const q = query.trim().toLowerCase();
    if (q.length < 3)
        return [];
    const [rows] = await pool_js_1.pool.execute(`SELECT id, email, first_name, last_name FROM users
     WHERE role = 'user' AND status = 'active' AND id != :fromUserId
     AND (LOWER(email) LIKE :emailQ OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE :nameQ)
     ORDER BY
       CASE WHEN LOWER(email) = :exact THEN 0 WHEN LOWER(email) LIKE :prefix THEN 1 ELSE 2 END,
       email ASC
     LIMIT 8`, {
        fromUserId,
        emailQ: `%${q}%`,
        nameQ: `%${q}%`,
        exact: q,
        prefix: `${q}%`,
    });
    return rows.map((row) => ({
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
    }));
}
async function shareTravelCredit(input) {
    if (input.amountMwk <= 0)
        throw new errorHandler_js_1.AppError(400, "Amount must be positive");
    if (input.fromUserId === input.toUserId)
        throw new errorHandler_js_1.AppError(400, "You cannot share credits with yourself");
    const conn = await pool_js_1.pool.getConnection();
    const transferRef = (0, uuid_1.v4)();
    try {
        await conn.beginTransaction();
        const [recipients] = await conn.execute(`SELECT id, email, first_name, last_name FROM users
       WHERE id = :id AND role = 'user' AND status = 'active'`, { id: input.toUserId });
        const recipient = recipients[0];
        if (!recipient)
            throw new errorHandler_js_1.AppError(404, "Recipient not found");
        const [senders] = await conn.execute(`SELECT first_name, last_name FROM users WHERE id = :id`, { id: input.fromUserId });
        const sender = senders[0];
        if (!sender)
            throw new errorHandler_js_1.AppError(404, "Account not found");
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
        const [senderCredit] = await conn.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`, { userId: input.fromUserId });
        const senderBalance = Number(senderCredit[0]?.balance_mwk ?? 0);
        if (senderBalance < input.amountMwk) {
            throw new errorHandler_js_1.AppError(400, `Insufficient travel credit. You have MWK ${senderBalance.toLocaleString()} but tried to share MWK ${input.amountMwk.toLocaleString()}.`);
        }
        const [recipientCredit] = await conn.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId`, { userId: input.toUserId });
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
        const debitId = (0, uuid_1.v4)();
        const creditId = (0, uuid_1.v4)();
        await conn.execute(`INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, created_by)
       VALUES (:id, :userId, 'debit', :amount, :balanceAfter, :description, :reference, :createdBy)`, {
            id: debitId,
            userId: input.fromUserId,
            amount: input.amountMwk,
            balanceAfter: senderNext,
            description: `Shared with ${recipientName}${noteSuffix}`,
            reference: transferRef,
            createdBy: input.fromUserId,
        });
        await conn.execute(`INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, created_by)
       VALUES (:id, :userId, 'credit', :amount, :balanceAfter, :description, :reference, :createdBy)`, {
            id: creditId,
            userId: input.toUserId,
            amount: input.amountMwk,
            balanceAfter: recipientNext,
            description: `Received from ${senderName}${noteSuffix}`,
            reference: transferRef,
            createdBy: input.fromUserId,
        });
        await conn.commit();
        await (0, audit_js_1.writeAuditLog)({
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
                id: recipient.id,
                email: recipient.email,
                firstName: recipient.first_name,
                lastName: recipient.last_name,
            },
        };
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
async function addTravelCreditToAllUsers(input) {
    if (input.amountMwk <= 0)
        throw new errorHandler_js_1.AppError(400, "Amount must be positive");
    const [users] = await pool_js_1.pool.execute(`SELECT id FROM users WHERE role = 'user' AND status = 'active'`);
    let usersCredited = 0;
    for (const user of users) {
        await addTravelCredit({
            userId: user.id,
            amountMwk: input.amountMwk,
            description: input.description,
            reference: input.reference,
            createdBy: input.createdBy,
        });
        usersCredited += 1;
    }
    await (0, audit_js_1.writeAuditLog)({
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
async function payApplicationWithTravelCredit(userId, applicationId, displayCurrency) {
    const existing = await (0, paymentLedger_js_1.getActiveLedgerForOrder)("flight_application", applicationId, userId);
    if (existing) {
        throw new errorHandler_js_1.AppError(409, "A payment is already in progress for this application. Cancel or complete it first.");
    }
    const snapshot = await (0, paymentLedger_js_1.buildApplicationOrderSnapshot)(applicationId, userId);
    const amountMwk = Number(snapshot.amountMwk);
    if (amountMwk <= 0)
        throw new errorHandler_js_1.AppError(400, "Invalid payment amount");
    const display = displayCurrency.toUpperCase();
    const chargeId = (0, paymentLedger_js_1.generateChargeId)();
    const ledgerId = (0, uuid_1.v4)();
    const conn = await pool_js_1.pool.getConnection();
    let postCommitEmail = null;
    try {
        await conn.beginTransaction();
        await ensureTravelCreditRow(conn, userId);
        const [creditRows] = await conn.execute(`SELECT balance_mwk FROM travel_credit WHERE user_id = :userId FOR UPDATE`, { userId });
        const balance = Number(creditRows[0]?.balance_mwk ?? 0);
        if (balance < amountMwk) {
            throw new errorHandler_js_1.AppError(400, `Insufficient travel credit. You have MWK ${balance.toLocaleString()} but need MWK ${amountMwk.toLocaleString()}.`);
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
        await conn.execute(`INSERT INTO payment_ledger (
        id, user_id, order_type, order_id, charge_id, payment_method,
        amount_mwk, payment_amount, currency, display_currency, status, order_snapshot,
        paychangu_status, verification_window_minutes, expires_at, completed_at, order_fulfilled_at
      ) VALUES (
        :id, :userId, 'flight_application', :orderId, :chargeId, 'travel_credit',
        :amountMwk, :amountMwk, 'MWK', :displayCurrency, 'completed', :orderSnapshot,
        'completed', 0, :now, :now, NULL
      )`, {
            id: ledgerId,
            userId,
            orderId: applicationId,
            chargeId,
            amountMwk,
            displayCurrency: display,
            orderSnapshot: JSON.stringify(enrichedSnapshot),
            now,
        });
        const txId = (0, uuid_1.v4)();
        await conn.execute(`INSERT INTO travel_credit_transactions
       (id, user_id, entry_type, amount_mwk, balance_after, description, reference, application_id, payment_ledger_id, created_by)
       VALUES (:id, :userId, 'debit', :amount, :balanceAfter, :description, :reference, :applicationId, :ledgerId, :userId)`, {
            id: txId,
            userId,
            amount: amountMwk,
            balanceAfter: nextBalance,
            description: `Payment for application ${snapshot.referenceNumber}`,
            reference: chargeId,
            applicationId,
            ledgerId,
        });
        const [ledgerRows] = await conn.execute(`SELECT * FROM payment_ledger WHERE id = :id`, { id: ledgerId });
        const ledger = ledgerRows[0];
        if (!ledger)
            throw new Error("Failed to create payment ledger entry");
        postCommitEmail = await (0, paymentLedger_js_1.fulfillFlightApplicationInTransaction)(conn, ledger);
        await conn.execute(`UPDATE payment_ledger SET order_fulfilled_at = UTC_TIMESTAMP() WHERE id = :id`, { id: ledgerId });
        await conn.commit();
        if (postCommitEmail)
            await postCommitEmail();
        await (0, audit_js_1.writeAuditLog)({
            userId,
            action: "travel_credit.payment",
            metadata: { applicationId, amountMwk, ledgerId, chargeId },
        });
        const [finalLedgerRows] = await pool_js_1.pool.execute(`SELECT * FROM payment_ledger WHERE id = :id`, { id: ledgerId });
        return {
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(finalLedgerRows[0]),
            balanceMwk: nextBalance,
            message: "Payment completed with travel credit.",
        };
    }
    catch (error) {
        await conn.rollback();
        throw error;
    }
    finally {
        conn.release();
    }
}
