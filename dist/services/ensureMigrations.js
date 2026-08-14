"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMigrations = ensureMigrations;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pool_js_1 = require("../db/pool.js");
const logger_js_1 = require("../logger.js");
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
function prepareMigrationSql(raw) {
    return raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .replace(/^\s*USE\s+[\w`]+\s*;\s*/gim, "");
}
function splitStatements(sql) {
    return prepareMigrationSql(sql)
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
}
async function runStatement(statement) {
    try {
        await pool_js_1.pool.execute(statement);
    }
    catch (error) {
        const code = error.code;
        if (code && SKIPPABLE_CODES.has(code))
            return;
        throw error;
    }
}
/** Apply schema-migrate-v*.sql files (uses DB from .env — strips USE biazo_travel). */
async function ensureMigrations() {
    const rootDir = process.cwd();
    let applied = 0;
    for (const file of MIGRATION_FILES) {
        const fullPath = node_path_1.default.join(rootDir, file);
        if (!node_fs_1.default.existsSync(fullPath))
            continue;
        const sql = node_fs_1.default.readFileSync(fullPath, "utf8");
        const statements = splitStatements(sql);
        for (const statement of statements) {
            await runStatement(statement);
            applied++;
        }
        logger_js_1.logger.info(`Migration file processed: ${file}`);
    }
    if (applied > 0) {
        logger_js_1.logger.info(`Database migrations ensured (${applied} statements)`);
    }
}
