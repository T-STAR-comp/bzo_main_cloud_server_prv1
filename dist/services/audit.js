"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = writeAuditLog;
exports.publicUser = publicUser;
const pool_js_1 = require("../db/pool.js");
const logger_js_1 = require("../logger.js");
async function writeAuditLog(input) {
    try {
        await pool_js_1.pool.execute(`INSERT INTO audit_logs (user_id, level, action, metadata, ip_address)
       VALUES (:userId, :level, :action, :metadata, :ipAddress)`, {
            userId: input.userId ?? null,
            level: input.level ?? "info",
            action: input.action,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
            ipAddress: input.ipAddress ?? null,
        });
    }
    catch (error) {
        logger_js_1.logger.error("Failed to write audit log", error);
    }
}
function publicUser(row, extended = false) {
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
    if (!extended)
        return base;
    return {
        ...base,
        username: row.username,
        role: row.role ?? "user",
        status: row.status ?? "active",
        adminNotes: row.admin_notes,
        lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    };
}
