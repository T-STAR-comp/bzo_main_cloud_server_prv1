import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";

export async function writeAuditLog(input: {
  userId?: string | null;
  level?: "info" | "warn" | "error";
  action: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  try {
    await pool.execute(
      `INSERT INTO audit_logs (user_id, level, action, metadata, ip_address)
       VALUES (:userId, :level, :action, :metadata, :ipAddress)`,
      {
        userId: input.userId ?? null,
        level: input.level ?? "info",
        action: input.action,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ipAddress: input.ipAddress ?? null,
      },
    );
  } catch (error) {
    logger.error("Failed to write audit log", error);
  }
}

export type UserRow = RowDataPacket & {
  id: string;
  email: string;
  username: string | null;
  password_hash: string;
  email_verified_at: Date | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  date_of_birth: Date | null;
  nationality: string | null;
  role: "user" | "admin" | "agent";
  status: "active" | "suspended" | "pending" | "flagged";
  admin_notes: string | null;
  last_login_at: Date | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
};

export function publicUser(row: UserRow, extended = false) {
  const base = {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    dateOfBirth: row.date_of_birth ? row.date_of_birth.toISOString().slice(0, 10) : null,
    nationality: row.nationality,
    avatarUrl: row.avatar_url,
    role: row.role ?? "user",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };

  if (!extended) return base;

  return {
    ...base,
    username: row.username,
    role: row.role ?? "user",
    status: row.status ?? "active",
    adminNotes: row.admin_notes,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  };
}
