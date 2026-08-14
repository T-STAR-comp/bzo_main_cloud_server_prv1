"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDefaultAdmin = ensureDefaultAdmin;
const uuid_1 = require("uuid");
const config_js_1 = require("../config.js");
const pool_js_1 = require("../db/pool.js");
const logger_js_1 = require("../logger.js");
const crypto_js_1 = require("../utils/crypto.js");
async function ensureDefaultAdmin() {
    const [admins] = await pool_js_1.pool.execute(`SELECT id, username, email FROM users WHERE role = 'admin' LIMIT 1`);
    if (admins[0]) {
        logger_js_1.logger.info(`Admin account already exists (${admins[0].username ?? admins[0].email})`);
        return;
    }
    const email = config_js_1.config.admin.email.toLowerCase();
    const username = config_js_1.config.admin.username.toLowerCase();
    const [byUsername] = await pool_js_1.pool.execute(`SELECT id, email, role FROM users WHERE username = :username LIMIT 1`, { username });
    if (byUsername[0]) {
        await pool_js_1.pool.execute(`UPDATE users SET role = 'admin', email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = :id`, { id: byUsername[0].id });
        logger_js_1.logger.info(`Promoted existing user "${username}" to admin`);
        return;
    }
    const [byEmail] = await pool_js_1.pool.execute(`SELECT id FROM users WHERE email = :email LIMIT 1`, { email });
    if (byEmail[0]) {
        const [usernameTaken] = await pool_js_1.pool.execute(`SELECT id FROM users WHERE username = :username AND id != :id LIMIT 1`, { username, id: byEmail[0].id });
        if (usernameTaken[0]) {
            logger_js_1.logger.warn(`Cannot seed admin: email ${email} exists but username "${username}" is taken. Create an admin manually or change ADMIN_EMAIL / ADMIN_USERNAME.`);
            return;
        }
        await pool_js_1.pool.execute(`UPDATE users SET role = 'admin', username = :username, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = :id`, { username, id: byEmail[0].id });
        logger_js_1.logger.info(`Promoted existing account ${email} to admin (username: ${username})`);
        return;
    }
    const userId = (0, uuid_1.v4)();
    const passwordHash = await (0, crypto_js_1.hashPassword)(config_js_1.config.admin.defaultPassword);
    await pool_js_1.pool.execute(`INSERT INTO users (
      id, email, username, password_hash, email_verified_at,
      first_name, last_name, nationality, role, status
    ) VALUES (
      :id, :email, :username, :passwordHash, UTC_TIMESTAMP(),
      'Biazo', 'Admin', 'Malawian', 'admin', 'active'
    )`, { id: userId, email, username, passwordHash });
    await pool_js_1.pool.execute(`INSERT INTO user_preferences (user_id) VALUES (:userId)`, { userId });
    await pool_js_1.pool.execute(`INSERT INTO travel_credit (user_id, balance_mwk) VALUES (:userId, 0)`, { userId });
    logger_js_1.logger.info(`Created default admin (username: ${username}, email: ${email}). Change password after first login.`);
}
