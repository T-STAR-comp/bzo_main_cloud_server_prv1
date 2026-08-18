import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";

export type ManualPaymentSourceRow = RowDataPacket & {
  id: string;
  label: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  branch_code: string | null;
  swift_code: string | null;
  currency: string;
  instructions: string | null;
  sort_order: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
};

export function mapManualPaymentSource(row: ManualPaymentSourceRow) {
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

export async function listManualPaymentSources(activeOnly = false) {
  let sql = `SELECT * FROM manual_payment_sources`;
  if (activeOnly) sql += ` WHERE is_active = 1`;
  sql += ` ORDER BY sort_order ASC, created_at ASC`;

  const [rows] = await pool.execute<ManualPaymentSourceRow[]>(sql);
  return rows.map(mapManualPaymentSource);
}

export async function getManualPaymentSource(id: string) {
  const [rows] = await pool.execute<ManualPaymentSourceRow[]>(
    `SELECT * FROM manual_payment_sources WHERE id = :id`,
    { id },
  );
  return rows[0] ? mapManualPaymentSource(rows[0]) : null;
}

export async function createManualPaymentSource(input: {
  label: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchCode?: string | null;
  swiftCode?: string | null;
  currency?: string;
  instructions?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const id = uuid();
  await pool.execute(
    `INSERT INTO manual_payment_sources (
      id, label, bank_name, account_name, account_number,
      branch_code, swift_code, currency, instructions, sort_order, is_active
    ) VALUES (
      :id, :label, :bankName, :accountName, :accountNumber,
      :branchCode, :swiftCode, :currency, :instructions, :sortOrder, :isActive
    )`,
    {
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
    },
  );
  return (await getManualPaymentSource(id))!;
}

export async function updateManualPaymentSource(
  id: string,
  input: Partial<{
    label: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    branchCode: string | null;
    swiftCode: string | null;
    currency: string;
    instructions: string | null;
    sortOrder: number;
    isActive: boolean;
  }>,
) {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

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

  if (!fields.length) return getManualPaymentSource(id);

  await pool.execute(`UPDATE manual_payment_sources SET ${fields.join(", ")} WHERE id = :id`, params as Record<string, string | number | null>);
  return getManualPaymentSource(id);
}

export async function deleteManualPaymentSource(id: string) {
  await pool.execute(`DELETE FROM manual_payment_sources WHERE id = :id`, { id });
}
