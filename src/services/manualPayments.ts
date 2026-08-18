import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { AppError } from "../middleware/errorHandler.js";
import { emailManualPaymentProofSubmittedAdmin } from "./applicationEmails.js";
import {
  buildApplicationOrderSnapshot,
  createLedgerEntry,
  fulfillOrderForLedger,
  generateChargeId,
  getLedgerById,
  type PaymentLedgerRow,
} from "./paymentLedger.js";
import { listManualPaymentSources } from "./manualPaymentSources.js";
import { savePaymentProofFile } from "./fileStorage.js";
import { emailContextFromRow, loadApplication } from "./applications.js";
import { writeAuditLog } from "./audit.js";

const MANUAL_REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateManualReference() {
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += MANUAL_REF_CHARS[Math.floor(Math.random() * MANUAL_REF_CHARS.length)];
  }
  return `BZO-${suffix}`;
}

export async function initiateManualApplicationPayment(
  userId: string,
  applicationId: string,
  displayCurrency: string,
) {
  if (config.usePaymentGateway) {
    throw new AppError(400, "Manual bank transfer is not enabled");
  }

  const sources = await listManualPaymentSources(true);
  if (!sources.length) {
    throw new AppError(503, "No bank accounts are configured for manual payment yet. Please contact support.");
  }

  const snapshot = await buildApplicationOrderSnapshot(applicationId, userId);
  const amountMwk = Number(snapshot.amountMwk);
  if (amountMwk <= 0) throw new AppError(400, "Invalid payment amount");

  const loaded = await loadApplication(applicationId);
  if (!loaded || loaded.raw.user_id !== userId) {
    throw new AppError(404, "Application not found");
  }
  if (loaded.application.status !== "awaiting_payment") {
    throw new AppError(409, "This application is not awaiting payment");
  }

  const [existingRows] = await pool.execute<PaymentLedgerRow[]>(
    `SELECT * FROM payment_ledger
     WHERE order_type = 'flight_application' AND order_id = :orderId AND user_id = :userId
       AND payment_method = 'manual_transfer' AND status = 'pending'
       AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC LIMIT 1`,
    { orderId: applicationId, userId },
  );
  const existing = existingRows[0];
  if (existing) {
    return existing;
  }

  const manualReference = generateManualReference();
  const chargeId = generateChargeId();
  const display = displayCurrency.toUpperCase();

  const enrichedSnapshot = {
    ...snapshot,
    displayCurrency: display,
    paymentCurrency: "MWK",
    paymentAmount: amountMwk,
    manualPaymentSources: sources,
    manualReference,
  };

  return createLedgerEntry({
    userId,
    orderType: "flight_application",
    orderId: applicationId,
    chargeId,
    paymentMethod: "manual_transfer",
    amountMwk,
    paymentAmount: amountMwk,
    currency: "MWK",
    displayCurrency: display,
    orderSnapshot: enrichedSnapshot,
    manualReference,
    paychanguStatus: "awaiting_transfer",
  });
}

const ALLOWED_PROOF_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export async function submitManualPaymentProof(
  userId: string,
  ledgerId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
) {
  const normalizedMime = mimeType.toLowerCase().split(";")[0]!.trim();
  if (!ALLOWED_PROOF_TYPES.has(normalizedMime)) {
    throw new AppError(400, "Proof must be a PDF or image (JPEG, PNG, WebP)");
  }
  if (buffer.length > 8 * 1024 * 1024) {
    throw new AppError(400, "File too large (max 8MB)");
  }

  const row = await getLedgerById(ledgerId, userId);
  if (!row) throw new AppError(404, "Payment not found");
  if (row.payment_method !== "manual_transfer") {
    throw new AppError(400, "This payment does not accept manual proof upload");
  }
  if (row.status !== "pending") {
    throw new AppError(409, "This payment is no longer awaiting proof");
  }
  if (row.proof_review_status === "submitted") {
    throw new AppError(409, "Proof is already submitted and awaiting admin review");
  }

  const relativePath = await savePaymentProofFile(ledgerId, fileName, buffer);

  await pool.execute(
    `UPDATE payment_ledger SET
      proof_file_path = :proofFilePath,
      proof_mime_type = :proofMimeType,
      proof_submitted_at = UTC_TIMESTAMP(),
      proof_review_status = 'submitted',
      proof_rejection_reason = NULL,
      proof_reviewed_at = NULL,
      proof_reviewed_by = NULL
     WHERE id = :id AND status = 'pending'`,
    {
      id: ledgerId,
      proofFilePath: relativePath,
      proofMimeType: normalizedMime,
    },
  );

  const updated = (await getLedgerById(ledgerId, userId))!;

  const loaded = await loadApplication(row.order_id);
  if (loaded) {
    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: userId },
    );
    const user = users[0];
    if (user) {
      const ctx = emailContextFromRow(
        loaded.raw,
        `${user.first_name} ${user.last_name}`,
        user.email,
      );
      await emailManualPaymentProofSubmittedAdmin({
        ...ctx,
        totalMwk: Number(row.amount_mwk),
        manualReference: row.manual_reference ?? updated.manual_reference ?? "",
        ledgerId,
      });
    }
  }

  return updated;
}

export async function approveManualPaymentProof(ledgerId: string, adminUserId: string) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [locked] = await conn.execute<PaymentLedgerRow[]>(
      `SELECT * FROM payment_ledger WHERE id = :id FOR UPDATE`,
      { id: ledgerId },
    );
    const row = locked[0];
    if (!row) throw new AppError(404, "Payment not found");
    if (row.payment_method !== "manual_transfer") {
      throw new AppError(400, "Not a manual bank transfer payment");
    }
    if (row.status !== "pending") {
      throw new AppError(409, "Payment is not pending review");
    }
    if (row.proof_review_status !== "submitted") {
      throw new AppError(409, "No proof submitted for review");
    }
    if (!row.proof_file_path) {
      throw new AppError(409, "Proof file is missing");
    }

    await conn.execute(
      `UPDATE payment_ledger SET
        status = 'completed',
        proof_review_status = 'approved',
        proof_reviewed_at = UTC_TIMESTAMP(),
        proof_reviewed_by = :adminUserId,
        completed_at = UTC_TIMESTAMP(),
        paychangu_status = 'approved',
        provider_response = :providerResponse
       WHERE id = :id`,
      {
        id: ledgerId,
        adminUserId,
        providerResponse: JSON.stringify({ manualApproval: true, approvedBy: adminUserId }),
      },
    );

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await fulfillOrderForLedger(ledgerId);

  await writeAuditLog({
    userId: adminUserId,
    action: "payment.manual_approved",
    metadata: { ledgerId },
  });

  return (await getLedgerById(ledgerId))!;
}

export async function rejectManualPaymentProof(
  ledgerId: string,
  adminUserId: string,
  reason: string,
) {
  const row = await getLedgerById(ledgerId);
  if (!row) throw new AppError(404, "Payment not found");
  if (row.payment_method !== "manual_transfer") {
    throw new AppError(400, "Not a manual bank transfer payment");
  }
  if (row.status !== "pending") {
    throw new AppError(409, "Payment is not pending review");
  }
  if (row.proof_review_status !== "submitted") {
    throw new AppError(409, "No proof submitted for review");
  }

  await pool.execute(
    `UPDATE payment_ledger SET
      proof_review_status = 'rejected',
      proof_reviewed_at = UTC_TIMESTAMP(),
      proof_reviewed_by = :adminUserId,
      proof_rejection_reason = :reason
     WHERE id = :id`,
    { id: ledgerId, adminUserId, reason },
  );

  await writeAuditLog({
    userId: adminUserId,
    action: "payment.manual_rejected",
    metadata: { ledgerId, reason },
  });

  return (await getLedgerById(ledgerId))!;
}
