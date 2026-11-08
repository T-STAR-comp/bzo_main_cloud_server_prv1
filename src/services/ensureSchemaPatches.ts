import fs from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";

const MIGRATION_FILES = [
  "schema-migrate-v2.sql",
  "schema-migrate-v3.sql",
  "schema-migrate-v4.sql",
  "schema-migrate-v5.sql",
  "schema-migrate-v6.sql",
  "schema-migrate-v7.sql",
  "schema-migrate-v8.sql",
  "schema-migrate-v9.sql",
  "schema-migrate-v10.sql",
  "schema-migrate-v11.sql",
  "schema-migrate-v12.sql",
  "schema-migrate-v13.sql",
  "schema-migrate-v14.sql",
  "schema-migrate-v15.sql",
];

const SKIPPABLE_CODES = new Set([
  "ER_DUP_FIELDNAME",
  "ER_DUP_KEYNAME",
  "ER_DUP_ENTRY",
  "ER_CANT_CREATE_TABLE",
  "ER_FK_DUP_NAME",
  "ER_KEY_COLUMN_DOES_NOT_EXITS",
  "ER_TABLE_EXISTS_ERROR",
  "ER_DUP_TABLE",
]);

function prepareMigrationSql(raw: string) {
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/^\s*USE\s+[\w`]+\s*;\s*/gim, "");
}

function splitStatements(sql: string) {
  return prepareMigrationSql(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runMigrationStatement(statement: string) {
  try {
    await pool.execute(statement);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code && SKIPPABLE_CODES.has(code)) return;
    throw error;
  }
}

async function ensureSqlMigrations() {
  const rootDir = process.cwd();
  let applied = 0;

  for (const file of MIGRATION_FILES) {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) continue;

    const statements = splitStatements(fs.readFileSync(fullPath, "utf8"));
    for (const statement of statements) {
      await runMigrationStatement(statement);
      applied++;
    }
    logger.info(`Migration file processed: ${file}`);
  }

  if (applied > 0) {
    logger.info(`Database migrations ensured (${applied} statements)`);
  }
}

const PATCHES: { name: string; sql: string }[] = [
  {
    name: "flight_applications.booking_id",
    sql: `ALTER TABLE flight_applications ADD COLUMN booking_id CHAR(36) NULL AFTER completed_at`,
  },
  {
    name: "tickets.passenger_names",
    sql: `ALTER TABLE tickets ADD COLUMN passenger_names VARCHAR(500) NULL AFTER user_id`,
  },
  {
    name: "flight_applications.payment_ledger_id",
    sql: `ALTER TABLE flight_applications ADD COLUMN payment_ledger_id CHAR(36) NULL AFTER paid_at`,
  },
  {
    name: "flight_applications.quote_line_items",
    sql: `ALTER TABLE flight_applications ADD COLUMN quote_line_items JSON NULL AFTER extra_charges_note`,
  },
  {
    name: "flight_application_tickets.ticket_record_id",
    sql: `ALTER TABLE flight_application_tickets ADD COLUMN ticket_record_id CHAR(36) NULL AFTER application_id`,
  },
  {
    name: "flight_application_tickets.segment_order",
    sql: `ALTER TABLE flight_application_tickets ADD COLUMN segment_order TINYINT NOT NULL DEFAULT 1 AFTER ticket_record_id`,
  },
  {
    name: "payment_ledger.travel_credit_method",
    sql: `ALTER TABLE payment_ledger MODIFY payment_method ENUM('mobile_money','bank','card','hosted_checkout','travel_credit','manual_transfer') NOT NULL`,
  },
  {
    name: "travel_credit_transactions",
    sql: `CREATE TABLE IF NOT EXISTS travel_credit_transactions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      entry_type ENUM('credit','debit','adjustment') NOT NULL,
      amount_mwk DECIMAL(14,2) NOT NULL,
      balance_after DECIMAL(14,2) NOT NULL,
      description VARCHAR(255) NOT NULL,
      reference VARCHAR(100) NULL,
      application_id CHAR(36) NULL,
      payment_ledger_id CHAR(36) NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_tct_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_tct_user (user_id, created_at),
      INDEX idx_tct_created (created_at)
    ) ENGINE=InnoDB`,
  },
  {
    name: "platform_settings",
    sql: `CREATE TABLE IF NOT EXISTS platform_settings (
      setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_by CHAR(36) NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,
  },
  {
    name: "report_schedule_log",
    sql: `CREATE TABLE IF NOT EXISTS report_schedule_log (
      id CHAR(36) NOT NULL PRIMARY KEY,
      report_type ENUM('weekly','monthly','quarterly','biannual','yearly','manual') NOT NULL,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      sent_to VARCHAR(255) NOT NULL,
      requested_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_report_log_type (report_type, created_at)
    ) ENGINE=InnoDB`,
  },
  {
    name: "flight_application_tickets.file_path",
    sql: `ALTER TABLE flight_application_tickets ADD COLUMN file_path VARCHAR(512) NULL AFTER mime_type`,
  },
  {
    name: "flight_application_tickets.file_data_nullable",
    sql: `ALTER TABLE flight_application_tickets MODIFY file_data MEDIUMBLOB NULL`,
  },
  {
    name: "destination_fun_facts",
    sql: `CREATE TABLE IF NOT EXISTS destination_fun_facts (
      id CHAR(36) NOT NULL PRIMARY KEY,
      destination_key VARCHAR(64) NOT NULL,
      fact_text TEXT NOT NULL,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_fun_facts_dest (destination_key, is_active)
    ) ENGINE=InnoDB`,
  },
  {
    name: "fun_fact_deliveries",
    sql: `CREATE TABLE IF NOT EXISTS fun_fact_deliveries (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      destination_key VARCHAR(64) NOT NULL,
      fun_fact_id CHAR(36) NULL,
      context ENUM('ticket_delivery','week_reminder','day_reminder') NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_ffd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_ffd_user_dest (user_id, destination_key)
    ) ENGINE=InnoDB`,
  },
  {
    name: "ticket_departure_reminders",
    sql: `CREATE TABLE IF NOT EXISTS ticket_departure_reminders (
      id CHAR(36) NOT NULL PRIMARY KEY,
      ticket_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      reminder_type ENUM('week_before','day_before') NOT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ticket_reminder (ticket_id, reminder_type),
      CONSTRAINT fk_tdr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      INDEX idx_tdr_sent (sent_at)
    ) ENGINE=InnoDB`,
  },
  {
    name: "agent_role_enum",
    sql: `ALTER TABLE users MODIFY role ENUM('user','admin','agent') NOT NULL DEFAULT 'user'`,
  },
  {
    name: "agent_commission_tables",
    sql: `CREATE TABLE IF NOT EXISTS commission_agents (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL UNIQUE,
      full_name VARCHAR(150) NOT NULL,
      phone VARCHAR(32) NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      agent_code VARCHAR(32) NOT NULL UNIQUE,
      referral_link VARCHAR(512) NOT NULL,
      status ENUM('active','paused','suspended') NOT NULL DEFAULT 'active',
      notes TEXT NULL,
      created_by_admin CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_commission_agents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      KEY idx_commission_agents_status (status),
      KEY idx_commission_agents_code (agent_code)
    ) ENGINE=InnoDB`,
  },
  {
    name: "agent_sale_records",
    sql: `CREATE TABLE IF NOT EXISTS commission_agent_records (
      id CHAR(36) NOT NULL PRIMARY KEY,
      agent_id CHAR(36) NOT NULL,
      user_id CHAR(36) NULL,
      application_id CHAR(36) NULL,
      sale_amount_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      commission_amount_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      sale_date DATETIME NOT NULL,
      source ENUM('checkout','manual','adjustment') NOT NULL DEFAULT 'checkout',
      source_reference VARCHAR(120) NULL,
      note TEXT NULL,
      created_by_admin CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_agent_records_agent FOREIGN KEY (agent_id) REFERENCES commission_agents(id) ON DELETE CASCADE,
      KEY idx_agent_records_agent_date (agent_id, sale_date),
      KEY idx_agent_records_user (user_id)
    ) ENGINE=InnoDB`,
  },
  {
    name: "agent_sale_application_unique",
    sql: `ALTER TABLE commission_agent_records ADD UNIQUE KEY uq_agent_record_application (application_id)`,
  },
  {
    name: "agent_redemptions",
    sql: `CREATE TABLE IF NOT EXISTS commission_agent_redemptions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      agent_id CHAR(36) NOT NULL,
      amount_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      note TEXT NULL,
      created_by_admin CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_agent_redemptions_agent FOREIGN KEY (agent_id) REFERENCES commission_agents(id) ON DELETE CASCADE,
      KEY idx_agent_redemptions_agent (agent_id, created_at)
    ) ENGINE=InnoDB`,
  },
  {
    name: "flight_applications_agent_fields",
    sql: `ALTER TABLE flight_applications ADD COLUMN agent_id CHAR(36) NULL AFTER user_id, ADD COLUMN agent_code VARCHAR(32) NULL AFTER agent_id, ADD COLUMN agent_commission_mwk DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER agent_code`,
  },
  {
    name: "flight_applications.profit_amount_mwk",
    sql: `ALTER TABLE flight_applications ADD COLUMN profit_amount_mwk DECIMAL(14,2) NULL DEFAULT NULL AFTER extra_charges_mwk`,
  },
];

export async function ensureSchemaPatches() {
  await ensureSqlMigrations();

  for (const patch of PATCHES) {
    try {
      await pool.execute(patch.sql);
      logger.info(`Schema patch applied: ${patch.name}`);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === "ER_DUP_FIELDNAME" || code === "ER_DUP_KEYNAME") {
        continue;
      }
      logger.warn(`Schema patch skipped (${patch.name}): ${(error as Error).message}`);
    }
  }

  const [cols] = await pool.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flight_applications' AND COLUMN_NAME = 'booking_id'`,
  );
  if (!cols[0]) {
    logger.warn("flight_applications.booking_id still missing - run npm run db:setup");
  }
}
