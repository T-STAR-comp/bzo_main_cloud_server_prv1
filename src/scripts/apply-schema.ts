import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { logger } from "../logger.js";

const rootDir = process.cwd();
const schemaPath = path.resolve(rootDir, "schema.sql");
const migrateV2 = path.resolve(rootDir, "schema-migrate-v2.sql");
const migrateV3 = path.resolve(rootDir, "schema-migrate-v3.sql");
const migrateV4 = path.resolve(rootDir, "schema-migrate-v4.sql");
const migrateV5 = path.resolve(rootDir, "schema-migrate-v5.sql");
const migrateV6 = path.resolve(rootDir, "schema-migrate-v6.sql");
const migrateV7 = path.resolve(rootDir, "schema-migrate-v7.sql");
const migrateV8 = path.resolve(rootDir, "schema-migrate-v8.sql");
const migrateV9 = path.resolve(rootDir, "schema-migrate-v9.sql");
const migrateV10 = path.resolve(rootDir, "schema-migrate-v10.sql");

function stripComments(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function splitStatements(sql: string) {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const SKIPPABLE_CODES = new Set([
  "ER_DUP_FIELDNAME",
  "ER_DUP_KEYNAME",
  "ER_DUP_ENTRY",
  "ER_CANT_CREATE_TABLE",
  "ER_FK_DUP_NAME",
  "ER_KEY_COLUMN_DOES_NOT_EXITS",
  "ER_CANT_CREATE_TABLE",
]);

async function runStatements(conn: mysql.Connection, statements: string[]) {
  for (const statement of statements) {
    const preview = statement.replace(/\s+/g, " ").slice(0, 72);
    try {
      logger.info(`Executing: ${preview}…`);
      await conn.query(statement);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code && SKIPPABLE_CODES.has(code)) {
        logger.warn(`Skipping (already applied): ${preview}`);
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  const schema = fs.readFileSync(schemaPath, "utf8");
  const statements = splitStatements(schema);

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false,
  });

  try {
    await runStatements(conn, statements);

    if (fs.existsSync(migrateV2)) {
      const migrate = fs.readFileSync(migrateV2, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV3)) {
      const migrate = fs.readFileSync(migrateV3, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV4)) {
      const migrate = fs.readFileSync(migrateV4, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV5)) {
      const migrate = fs.readFileSync(migrateV5, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV6)) {
      const migrate = fs.readFileSync(migrateV6, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV7)) {
      const migrate = fs.readFileSync(migrateV7, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV8)) {
      const migrate = fs.readFileSync(migrateV8, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV9)) {
      const migrate = fs.readFileSync(migrateV9, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    if (fs.existsSync(migrateV10)) {
      const migrate = fs.readFileSync(migrateV10, "utf8");
      await runStatements(conn, splitStatements(migrate));
    }

    logger.info("Schema applied successfully.");

    const [tables] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
      [config.db.database],
    );
    logger.info(`Tables in ${config.db.database}: ${tables.map((t) => t.TABLE_NAME).join(", ")}`);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  logger.error("Schema apply failed", error);
  process.exit(1);
});
