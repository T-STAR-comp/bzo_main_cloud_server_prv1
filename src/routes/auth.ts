import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { asyncHandler, AppError } from "../middleware/errorHandler.js";
import { writeAuditLog, publicUser, type UserRow } from "../services/audit.js";
import { sendEmailCode } from "../services/email.js";
import { hashPassword, verifyPassword, hashToken, verifyTokenHash } from "../utils/crypto.js";
import {
  generateNumericCode,
  signAccessToken,
  signRefreshToken,
  type UserRole,
  verifyRefreshToken,
} from "../utils/jwt.js";

export const authRouter = Router();

const passwordSchema = z
  .string()
  .min(8)
  .regex(/[A-Z]/, "Must include uppercase")
  .regex(/[0-9]/, "Must include number")
  .regex(/[^A-Za-z0-9]/, "Must include symbol");

const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
  .refine((value) => {
    const dob = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) return false;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (dob >= today) return false;
    const minDob = new Date(today);
    minDob.setUTCFullYear(minDob.getUTCFullYear() - 120);
    return dob >= minDob;
  }, "Enter a valid date of birth");

const signupSchema = z.object({
  email: z.string().email().max(255),
  password: passwordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: dateOfBirthSchema,
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/),
  purpose: z.enum(["signup", "login"]),
});

async function createEmailCode(userId: string, purpose: "signup" | "login" | "password_reset") {
  const code = generateNumericCode();
  const codeHash = await hashToken(code);
  const id = uuid();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await pool.execute(
    `UPDATE email_codes SET consumed_at = UTC_TIMESTAMP()
     WHERE user_id = :userId AND purpose = :purpose AND consumed_at IS NULL`,
    { userId, purpose },
  );

  await pool.execute(
    `INSERT INTO email_codes (id, user_id, code_hash, purpose, expires_at)
     VALUES (:id, :userId, :codeHash, :purpose, :expiresAt)`,
    { id, userId, codeHash, purpose, expiresAt },
  );

  return code;
}

async function verifyEmailCode(userId: string, code: string, purpose: "signup" | "login" | "password_reset") {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, code_hash, expires_at, consumed_at FROM email_codes
     WHERE user_id = :userId AND purpose = :purpose AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    { userId, purpose },
  );

  const row = rows[0];
  if (!row) throw new AppError(400, "No active verification code");
  if (new Date(row.expires_at as string) < new Date()) throw new AppError(400, "Code expired");

  const valid = await verifyTokenHash(code, row.code_hash as string);
  if (!valid) throw new AppError(400, "Invalid verification code");

  await pool.execute(`UPDATE email_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = :id`, {
    id: row.id,
  });
}

async function issueSession(
  userId: string,
  email: string,
  role: UserRole,
  req: { ip?: string; headers: Record<string, unknown> },
) {
  const sessionId = uuid();
  const refreshToken = signRefreshToken(userId, sessionId);
  const refreshHash = await hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await pool.execute(
    `INSERT INTO refresh_sessions (id, user_id, refresh_token_hash, expires_at, user_agent, ip_address)
     VALUES (:id, :userId, :hash, :expiresAt, :ua, :ip)`,
    {
      id: sessionId,
      userId,
      hash: refreshHash,
      expiresAt,
      ua: (req.headers["user-agent"] as string) ?? null,
      ip: req.ip ?? null,
    },
  );

  await pool.execute(`UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = :id`, { id: userId });

  const accessToken = signAccessToken(userId, email, role);
  return { accessToken, refreshToken };
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = signupSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const [existing] = await pool.execute<UserRow[]>(`SELECT id FROM users WHERE email = :email`, { email });
    if (existing[0]) throw new AppError(409, "Email already registered");

    const userId = uuid();
    const passwordHash = await hashPassword(body.password);

    await pool.execute(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, date_of_birth, nationality)
       VALUES (:id, :email, :passwordHash, :firstName, :lastName, :dateOfBirth, 'Malawian')`,
      {
        id: userId,
        email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth,
      },
    );

    await pool.execute(`INSERT INTO user_preferences (user_id) VALUES (:userId)`, { userId });
    await pool.execute(`INSERT INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, { userId });

    const code = await createEmailCode(userId, "signup");
    await sendEmailCode(email, code, "signup");

    await writeAuditLog({
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
  }),
);

authRouter.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const body = verifySchema.parse({ ...req.body, purpose: "signup" });
    const email = body.email.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user) throw new AppError(404, "User not found");

    await verifyEmailCode(user.id, body.code, "signup");

    await pool.execute(`UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = :id`, { id: user.id });

    const tokens = await issueSession(user.id, user.email, user.role ?? "user", req);

    await writeAuditLog({
      userId: user.id,
      action: "auth.email_verified",
      ipAddress: req.ip ?? null,
    });

    res.json({
      user: publicUser({ ...user, email_verified_at: new Date() }, true),
      ...tokens,
    });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user) throw new AppError(401, "Invalid email or password");

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await writeAuditLog({
        userId: user.id,
        level: "warn",
        action: "auth.login_failed",
        ipAddress: req.ip ?? null,
      });
      throw new AppError(401, "Invalid email or password");
    }

    if (!user.email_verified_at) {
      const code = await createEmailCode(user.id, "signup");
      await sendEmailCode(email, code, "signup");
      res.status(403).json({
        error: "Email not verified",
        requiresVerification: true,
        email,
      });
      return;
    }

    const code = await createEmailCode(user.id, "login");
    await sendEmailCode(email, code, "login");

    await writeAuditLog({
      userId: user.id,
      action: "auth.login_code_sent",
      ipAddress: req.ip ?? null,
    });

    res.json({
      message: "Verification code sent to your email.",
      requiresLoginCode: true,
      email,
    });
  }),
);

authRouter.post(
  "/verify-login",
  asyncHandler(async (req, res) => {
    const body = verifySchema.parse({ ...req.body, purpose: "login" });
    const email = body.email.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user) throw new AppError(404, "User not found");

    await verifyEmailCode(user.id, body.code, "login");

    const tokens = await issueSession(user.id, user.email, user.role ?? "user", req);

    await writeAuditLog({
      userId: user.id,
      action: "auth.login_success",
      ipAddress: req.ip ?? null,
    });

    res.json({
      user: publicUser(user, true),
      ...tokens,
    });
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = z.string().min(1).parse(req.body.refreshToken);
    const payload = verifyRefreshToken(token);

    const [sessions] = await pool.execute<RowDataPacket[]>(
      `SELECT id, user_id, refresh_token_hash, expires_at, revoked_at FROM refresh_sessions WHERE id = :id`,
      { id: payload.sid },
    );
    const session = sessions[0];
    if (!session || session.revoked_at) throw new AppError(401, "Invalid session");

    const valid = await verifyTokenHash(token, session.refresh_token_hash as string);
    if (!valid) throw new AppError(401, "Invalid session");

    if (new Date(session.expires_at as string) < new Date()) throw new AppError(401, "Session expired");

    const [users] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE id = :id`, {
      id: session.user_id,
    });
    const user = users[0];
    if (!user) throw new AppError(401, "User not found");

    const accessToken = signAccessToken(user.id, user.email, user.role ?? "user");
    res.json({ accessToken });
  }),
);

const adminLoginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1),
});

authRouter.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    const body = adminLoginSchema.parse(req.body);
    const username = body.username.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(
      `SELECT * FROM users WHERE username = :username AND role = 'admin'`,
      { username },
    );
    const user = rows[0];
    if (!user) throw new AppError(401, "Invalid credentials");

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await writeAuditLog({
        userId: user.id,
        level: "warn",
        action: "auth.admin_login_failed",
        ipAddress: req.ip ?? null,
      });
      throw new AppError(401, "Invalid credentials");
    }

    const code = await createEmailCode(user.id, "login");
    await sendEmailCode(user.email, code, "login");

    await writeAuditLog({
      userId: user.id,
      action: "auth.admin_login_code_sent",
      ipAddress: req.ip ?? null,
    });

    res.json({
      message: "Verification code sent to admin email.",
      requiresLoginCode: true,
      email: user.email,
    });
  }),
);

authRouter.post(
  "/admin/verify-login",
  asyncHandler(async (req, res) => {
    const body = verifySchema.parse({ ...req.body, purpose: "login" });
    const email = body.email.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(
      `SELECT * FROM users WHERE email = :email AND role = 'admin'`,
      { email },
    );
    const user = rows[0];
    if (!user) throw new AppError(403, "Admin access required");

    await verifyEmailCode(user.id, body.code, "login");

    const tokens = await issueSession(user.id, user.email, "admin", req);

    await writeAuditLog({
      userId: user.id,
      action: "auth.admin_login_success",
      ipAddress: req.ip ?? null,
    });

    res.json({
      user: publicUser(user, true),
      ...tokens,
    });
  }),
);

async function revokeUserSessions(userId: string) {
  await pool.execute(
    `UPDATE refresh_sessions SET revoked_at = UTC_TIMESTAMP()
     WHERE user_id = :userId AND revoked_at IS NULL`,
    { userId },
  );
}

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email: rawEmail } = forgotPasswordSchema.parse(req.body);
    const email = rawEmail.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];

    if (user?.email_verified_at) {
      const code = await createEmailCode(user.id, "password_reset");
      await sendEmailCode(email, code, "password_reset");

      await writeAuditLog({
        userId: user.id,
        action: "auth.password_reset_requested",
        ipAddress: req.ip ?? null,
      });
    }

    res.json({
      message: "If an account exists for that email, a reset code has been sent.",
      email,
    });
  }),
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const [rows] = await pool.execute<UserRow[]>(`SELECT * FROM users WHERE email = :email`, { email });
    const user = rows[0];
    if (!user) throw new AppError(400, "Invalid reset code");

    await verifyEmailCode(user.id, body.code, "password_reset");

    const passwordHash = await hashPassword(body.password);
    await pool.execute(`UPDATE users SET password_hash = :passwordHash WHERE id = :id`, {
      id: user.id,
      passwordHash,
    });

    await revokeUserSessions(user.id);

    await writeAuditLog({
      userId: user.id,
      action: "auth.password_reset_completed",
      ipAddress: req.ip ?? null,
    });

    res.json({ message: "Password updated. You can sign in with your new password." });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = z.string().optional().parse(req.body.refreshToken);
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        await pool.execute(`UPDATE refresh_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = :id`, {
          id: payload.sid,
        });
      } catch {
        /* ignore invalid token on logout */
      }
    }
    res.json({ message: "Signed out" });
  }),
);
