"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapManualPaymentSource = mapManualPaymentSource;
exports.listManualPaymentSources = listManualPaymentSources;
exports.getManualPaymentSource = getManualPaymentSource;
exports.createManualPaymentSource = createManualPaymentSource;
exports.updateManualPaymentSource = updateManualPaymentSource;
exports.deleteManualPaymentSource = deleteManualPaymentSource;
const uuid_1 = require("uuid");
const pool_js_1 = require("../db/pool.js");
function mapManualPaymentSource(row) {
    return {
        id: row.id,
        label: row.label,
        bankName: row.bank_name,
        accountName: row.account_name,
        accountNumber: row.account_number,
        branchCode: row.branch_code,
        swiftCode: row.swift_code,
        currency: row.currency,
        instructions: row.instructions,
        sortOrder: Number(row.sort_order),
        isActive: Boolean(row.is_active),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
    };
}
async function listManualPaymentSources(activeOnly = false) {
    let sql = `SELECT * FROM manual_payment_sources`;
    if (activeOnly)
        sql += ` WHERE is_active = 1`;
    sql += ` ORDER BY sort_order ASC, created_at ASC`;
    const [rows] = await pool_js_1.pool.execute(sql);
    return rows.map(mapManualPaymentSource);
}
async function getManualPaymentSource(id) {
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM manual_payment_sources WHERE id = :id`, { id });
    return rows[0] ? mapManualPaymentSource(rows[0]) : null;
}
async function createManualPaymentSource(input) {
    const id = (0, uuid_1.v4)();
    await pool_js_1.pool.execute(`INSERT INTO manual_payment_sources (
      id, label, bank_name, account_name, account_number,
      branch_code, swift_code, currency, instructions, sort_order, is_active
    ) VALUES (
      :id, :label, :bankName, :accountName, :accountNumber,
      :branchCode, :swiftCode, :currency, :instructions, :sortOrder, :isActive
    )`, {
        id,
        label: input.label,
        bankName: input.bankName,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        branchCode: input.branchCode ?? null,
        swiftCode: input.swiftCode ?? null,
        currency: (input.currency ?? "MWK").toUpperCase(),
        instructions: input.instructions ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive === false ? 0 : 1,
    });
    return (await getManualPaymentSource(id));
}
async function updateManualPaymentSource(id, input) {
    const fields = [];
    const params = { id };
    if (input.label !== undefined) {
        fields.push("label = :label");
        params.label = input.label;
    }
    if (input.bankName !== undefined) {
        fields.push("bank_name = :bankName");
        params.bankName = input.bankName;
    }
    if (input.accountName !== undefined) {
        fields.push("account_name = :accountName");
        params.accountName = input.accountName;
    }
    if (input.accountNumber !== undefined) {
        fields.push("account_number = :accountNumber");
        params.accountNumber = input.accountNumber;
    }
    if (input.branchCode !== undefined) {
        fields.push("branch_code = :branchCode");
        params.branchCode = input.branchCode;
    }
    if (input.swiftCode !== undefined) {
        fields.push("swift_code = :swiftCode");
        params.swiftCode = input.swiftCode;
    }
    if (input.currency !== undefined) {
        fields.push("currency = :currency");
        params.currency = input.currency.toUpperCase();
    }
    if (input.instructions !== undefined) {
        fields.push("instructions = :instructions");
        params.instructions = input.instructions;
    }
    if (input.sortOrder !== undefined) {
        fields.push("sort_order = :sortOrder");
        params.sortOrder = input.sortOrder;
    }
    if (input.isActive !== undefined) {
        fields.push("is_active = :isActive");
        params.isActive = input.isActive ? 1 : 0;
    }
    if (!fields.length)
        return getManualPaymentSource(id);
    await pool_js_1.pool.execute(`UPDATE manual_payment_sources SET ${fields.join(", ")} WHERE id = :id`, params);
    return getManualPaymentSource(id);
}
async function deleteManualPaymentSource(id) {
    await pool_js_1.pool.execute(`DELETE FROM manual_payment_sources WHERE id = :id`, { id });
}
