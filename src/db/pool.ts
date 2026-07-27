import mysql from "mysql2/promise";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  timezone: "Z",
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export async function pingDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    logger.info("MySQL connection established");
  } finally {
    conn.release();
  }
}
