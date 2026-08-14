"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const pool_js_1 = require("../db/pool.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const audit_js_1 = require("../services/audit.js");
const email_js_1 = require("../services/email.js");
const crypto_js_1 = require("../utils/crypto.js");
const jwt_js_1 = require("../utils/jwt.js");
exports.authRouter = (0, express_1.Router)();
const passwordSchema = zod_1.z
    .string()
    .min(8)
    .regex(/[A-Z]/, "Must include uppercase")
    .regex(/[0-9]/, "Must include number")
    .regex(/[^A-Za-z0-9]/, "Must include symbol");
const dateOfBirthSchema = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
    .refine((value) => {
    const dob = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(dob.getTime()))
        return false;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (dob >= today)
        return false;
    const minDob = new Date(today);
    minDob.setUTCFullYear(minDob.getUTCFullYear() - 120);
    return dob >= minDob;
}, "Enter a valid date of birth");
const signupSchema = zod_1.z.object({
    email: zod_1.z.string().email().max(255),
    password: passwordSchema,
    firstName: zod_1.z.string().min(1).max(100),
    lastName: zod_1.z.string().min(1).max(100),
    dateOfBirth: dateOfBirthSchema,
});
const forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
const resetPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    code: zod_1.z.string().length(6).regex(/^\d+$/),
    password: passwordSchema,
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
const verifySchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    code: zod_1.z.string().length(6).regex(/^\d+$/),
    purpose: zod_1.z.enum(["signup", "login"]),
});
async function createEmailCode(userId, purpose) {
    const code = (0, jwt_js_1.generateNumericCode)();
    const codeHash = await (0, crypto_js_1.hashToken)(code);
    const id = (0, uuid_1.v4)();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool_js_1.pool.execute(`UPDATE email_codes SET consumed_at = UTC_TIMESTAMP()
     WHERE user_id = :userId AND purpose = :purpose AND consumed_at IS NULL`, { userId, purpose });
    await pool_js_1.pool.execute(`INSERT INTO email_codes (id, user_id, code_hash, purpose, expires_at)
     VALUES (:id, :userId, :codeHash, :purpose, :expiresAt)`, { id, userId, codeHash, purpose, expiresAt });
    return code;
}
async function verifyEmailCode(userId, code, purpose) {
    const [rows] = await pool_js_1.pool.execute(`SELECT id, code_hash, expires_at, consumed_at FROM email_codes
     WHERE user_id = :userId AND purpose = :purpose AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`, { userId, purpose });
    const row = rows[0];
    if (!row)
        throw new errorHandler_js_1.AppError(400, "No active verification code");
    if (new Date(row.expires_at) < new Date())
        throw new errorHandler_js_1.AppError(400, "Code expired");
    const valid = await (0, crypto_js_1.verifyTokenHash)(code, row.code_hash);
    if (!valid)
        throw new errorHandler_js_1.AppError(400, "Invalid verification code");
    await pool_js_1.pool.execute(`UPDATE email_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = :id`, {
        id: row.id,
    });
}
async function issueSession(userId, email, role, req) {
    const sessionId = (0, uuid_1.v4)();
    const refreshToken = (0, jwt_js_1.signRefreshToken)(userId, sessionId);
    const refreshHash = await (0, crypto_js_1.hashToken)(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool_js_1.pool.execute(`INSERT INTO refresh_sessions (id, user_id, refresh_token_hash, expires_at, user_agent, ip_address)
     VALUES (:id, :userId, :hash, :expiresAt, :ua, :ip)`, {
        id: sessionId,
        userId,
        hash: refreshHash,
        expiresAt,
        ua: req.headers["user-agent"] ?? null,
        ip: req.ip ?? null,
    });
    await pool_js_1.pool.execute(`UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = :id`, { id: userId });
    const accessToken = (0, jwt_js_1.signAccessToken)(userId, email, role);
    return { accessToken, refreshToken };
}
exports.authRouter.post("/signup", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = signupSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const [existing] = await pool_js_1.pool.execute(`SELECT id FROM users WHERE email = :email`, { email });
    if (existing[0])
        throw new errorHandler_js_1.AppError(409, "Email already registered");
    const userId = (0, uuid_1.v4)();
    const passwordHash = await (0, crypto_js_1.hashPassword)(body.password);
    await pool_js_1.pool.execute(`INSERT INTO users (id, email, password_hash, first_name, last_name, date_of_birth, nationality)
       VALUES (:id, :email, :passwordHash, :firstName, :lastName, :dateOfBirth, 'Malawian')`, {
        id: userId,
        email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth,
    });
    await pool_js_1.pool.execute(`INSERT INTO user_preferences (user_id) VALUES (:userId)`, { userId });
    await pool_js_1.pool.execute(`INSERT INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, { userId });
    const code = await createEmailCode(userId, "signup");
    await (0, email_js_1.sendEmailCode)(email, code, "signup");
    await (0, audit_js_1.writeAuditLog)({
        userId,
        action: "auth.signup",
        metadata: { email },
        ipAddress: req.ip ?? null,
    });
    res.status(201).json({
        message: "Account created. Check your email for a verification code.",
        requiresVerification: true,
        email,
    });
}));
exports.authRouter.post("/verify-email", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = verifySchema.parse({ ...req.body, purpose: "signup" });
    const email = body.email.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user)
        throw new errorHandler_js_1.AppError(404, "User not found");
    await verifyEmailCode(user.id, body.code, "signup");
    await pool_js_1.pool.execute(`UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = :id`, { id: user.id });
    const tokens = await issueSession(user.id, user.email, user.role ?? "user", req);
    await (0, audit_js_1.writeAuditLog)({
        userId: user.id,
        action: "auth.email_verified",
        ipAddress: req.ip ?? null,
    });
    res.json({
        user: (0, audit_js_1.publicUser)({ ...user, email_verified_at: new Date() }, true),
        ...tokens,
    });
}));
exports.authRouter.post("/login", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user)
        throw new errorHandler_js_1.AppError(401, "Invalid email or password");
    const valid = await (0, crypto_js_1.verifyPassword)(body.password, user.password_hash);
    if (!valid) {
        await (0, audit_js_1.writeAuditLog)({
            userId: user.id,
            level: "warn",
            action: "auth.login_failed",
            ipAddress: req.ip ?? null,
        });
        throw new errorHandler_js_1.AppError(401, "Invalid email or password");
    }
    if (!user.email_verified_at) {
        const code = await createEmailCode(user.id, "signup");
        await (0, email_js_1.sendEmailCode)(email, code, "signup");
        res.status(403).json({
            error: "Email not verified",
            requiresVerification: true,
            email,
        });
        return;
    }
    const code = await createEmailCode(user.id, "login");
    await (0, email_js_1.sendEmailCode)(email, code, "login");
    await (0, audit_js_1.writeAuditLog)({
        userId: user.id,
        action: "auth.login_code_sent",
        ipAddress: req.ip ?? null,
    });
    res.json({
        message: "Verification code sent to your email.",
        requiresLoginCode: true,
        email,
    });
}));
exports.authRouter.post("/verify-login", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = verifySchema.parse({ ...req.body, purpose: "login" });
    const email = body.email.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user)
        throw new errorHandler_js_1.AppError(404, "User not found");
    await verifyEmailCode(user.id, body.code, "login");
    const tokens = await issueSession(user.id, user.email, user.role ?? "user", req);
    await (0, audit_js_1.writeAuditLog)({
        userId: user.id,
        action: "auth.login_success",
        ipAddress: req.ip ?? null,
    });
    res.json({
        user: (0, audit_js_1.publicUser)(user, true),
        ...tokens,
    });
}));
exports.authRouter.post("/refresh", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const token = zod_1.z.string().min(1).parse(req.body.refreshToken);
    const payload = (0, jwt_js_1.verifyRefreshToken)(token);
    const [sessions] = await pool_js_1.pool.execute(`SELECT id, user_id, refresh_token_hash, expires_at, revoked_at FROM refresh_sessions WHERE id = :id`, { id: payload.sid });
    const session = sessions[0];
    if (!session || session.revoked_at)
        throw new errorHandler_js_1.AppError(401, "Invalid session");
    const valid = await (0, crypto_js_1.verifyTokenHash)(token, session.refresh_token_hash);
    if (!valid)
        throw new errorHandler_js_1.AppError(401, "Invalid session");
    if (new Date(session.expires_at) < new Date())
        throw new errorHandler_js_1.AppError(401, "Session expired");
    const [users] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE id = :id`, {
        id: session.user_id,
    });
    const user = users[0];
    if (!user)
        throw new errorHandler_js_1.AppError(401, "User not found");
    const accessToken = (0, jwt_js_1.signAccessToken)(user.id, user.email, user.role ?? "user");
    res.json({ accessToken });
}));
const adminLoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(50),
    password: zod_1.z.string().min(1),
});
exports.authRouter.post("/admin/login", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = adminLoginSchema.parse(req.body);
    const username = body.username.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE username = :username AND role = 'admin'`, { username });
    const user = rows[0];
    if (!user)
        throw new errorHandler_js_1.AppError(401, "Invalid credentials");
    const valid = await (0, crypto_js_1.verifyPassword)(body.password, user.password_hash);
    if (!valid) {
        await (0, audit_js_1.writeAuditLog)({
            userId: user.id,
            level: "warn",
            action: "auth.admin_login_failed",
            ipAddress: req.ip ?? null,
        });
        throw new errorHandler_js_1.AppError(401, "Invalid credentials");
    }
    const code = await createEmailCode(user.id, "login");
    await (0, email_js_1.sendEmailCode)(user.email, code, "login");
    await (0, audit_js_1.writeAuditLog)({
        userId: user.id,
        action: "auth.admin_login_code_sent",
        ipAddress: req.ip ?? null,
    });
    res.json({
        message: "Verification code sent to admin email.",
        requiresLoginCode: true,
        email: user.email,
    });
}));
exports.authRouter.post("/admin/verify-login", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = verifySchema.parse({ ...req.body, purpose: "login" });
    const email = body.email.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE email = :email AND role = 'admin'`, { email });
    const user = rows[0];
    if (!user)
        throw new errorHandler_js_1.AppError(403, "Admin access required");
    await verifyEmailCode(user.id, body.code, "login");
    const tokens = await issueSession(user.id, user.email, "admin", req);
    await (0, audit_js_1.writeAuditLog)({
        userId: user.id,
        action: "auth.admin_login_success",
        ipAddress: req.ip ?? null,
    });
    res.json({
        user: (0, audit_js_1.publicUser)(user, true),
        ...tokens,
    });
}));
async function revokeUserSessions(userId) {
    await pool_js_1.pool.execute(`UPDATE refresh_sessions SET revoked_at = UTC_TIMESTAMP()
     WHERE user_id = :userId AND revoked_at IS NULL`, { userId });
}
exports.authRouter.post("/forgot-password", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const { email: rawEmail } = forgotPasswordSchema.parse(req.body);
    const email = rawEmail.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (user?.email_verified_at) {
        const code = await createEmailCode(user.id, "password_reset");
        await (0, email_js_1.sendEmailCode)(email, code, "password_reset");
        await (0, audit_js_1.writeAuditLog)({
            userId: user.id,
            action: "auth.password_reset_requested",
            ipAddress: req.ip ?? null,
        });
    }
    res.json({
        message: "If an account exists for that email, a reset code has been sent.",
        email,
    });
}));
exports.authRouter.post("/reset-password", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const [rows] = await pool_js_1.pool.execute(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user)
        throw new errorHandler_js_1.AppError(400, "Invalid reset code");
    await verifyEmailCode(user.id, body.code, "password_reset");
    const passwordHash = await (0, crypto_js_1.hashPassword)(body.password);
    await pool_js_1.pool.execute(`UPDATE users SET password_hash = :passwordHash WHERE id = :id`, {
        id: user.id,
        passwordHash,
    });
    await revokeUserSessions(user.id);
    await (0, audit_js_1.writeAuditLog)({
        userId: user.id,
        action: "auth.password_reset_completed",
        ipAddress: req.ip ?? null,
    });
    res.json({ message: "Password updated. You can sign in with your new password." });
}));
exports.authRouter.post("/logout", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const token = zod_1.z.string().optional().parse(req.body.refreshToken);
    if (token) {
        try {
            const payload = (0, jwt_js_1.verifyRefreshToken)(token);
            await pool_js_1.pool.execute(`UPDATE refresh_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = :id`, {
                id: payload.sid,
            });
        }
        catch {
            /* ignore invalid token on logout */
        }
    }
    res.json({ message: "Signed out" });
}));
