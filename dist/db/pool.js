"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.pingDatabase = pingDatabase;
const promise_1 = __importDefault(require("mysql2/promise"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../logger.js");
exports.pool = promise_1.default.createPool({
    host: config_js_1.config.db.host,
    port: config_js_1.config.db.port,
    user: config_js_1.config.db.user,
    password: config_js_1.config.db.password,
    database: config_js_1.config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});
async function pingDatabase() {
    const conn = await exports.pool.getConnection();
    try {
        await conn.ping();
        logger_js_1.logger.info("MySQL connection established");
    }
    finally {
        conn.release();
    }
}
