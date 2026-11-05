"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const promise_1 = __importDefault(require("mysql2/promise"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../logger.js");
const rootDir = process.cwd();
const schemaPath = node_path_1.default.resolve(rootDir, "schema.sql");
const migrateV2 = node_path_1.default.resolve(rootDir, "schema-migrate-v2.sql");
const migrateV3 = node_path_1.default.resolve(rootDir, "schema-migrate-v3.sql");
const migrateV4 = node_path_1.default.resolve(rootDir, "schema-migrate-v4.sql");
const migrateV5 = node_path_1.default.resolve(rootDir, "schema-migrate-v5.sql");
const migrateV6 = node_path_1.default.resolve(rootDir, "schema-migrate-v6.sql");
const migrateV7 = node_path_1.default.resolve(rootDir, "schema-migrate-v7.sql");
const migrateV8 = node_path_1.default.resolve(rootDir, "schema-migrate-v8.sql");
const migrateV9 = node_path_1.default.resolve(rootDir, "schema-migrate-v9.sql");
const migrateV10 = node_path_1.default.resolve(rootDir, "schema-migrate-v10.sql");
const migrateV11 = node_path_1.default.resolve(rootDir, "schema-migrate-v11.sql");
const migrateV12 = node_path_1.default.resolve(rootDir, "schema-migrate-v12.sql");
const migrateV13 = node_path_1.default.resolve(rootDir, "schema-migrate-v13.sql");
const migrateV14 = node_path_1.default.resolve(rootDir, "schema-migrate-v14.sql");
function stripComments(sql) {
    return sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
}
function splitStatements(sql) {
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
async function runStatements(conn, statements) {
    for (const statement of statements) {
        const preview = statement.replace(/\s+/g, " ").slice(0, 72);
        try {
            logger_js_1.logger.info(`Executing: ${preview}…`);
            await conn.query(statement);
        }
        catch (error) {
            const code = error.code;
            if (code && SKIPPABLE_CODES.has(code)) {
                logger_js_1.logger.warn(`Skipping (already applied): ${preview}`);
                continue;
            }
            throw error;
        }
    }
}
async function main() {
    const schema = node_fs_1.default.readFileSync(schemaPath, "utf8");
    const statements = splitStatements(schema);
    const conn = await promise_1.default.createConnection({
        host: config_js_1.config.db.host,
        port: config_js_1.config.db.port,
        user: config_js_1.config.db.user,
        password: config_js_1.config.db.password,
        multipleStatements: false,
    });
    try {
        await runStatements(conn, statements);
        if (node_fs_1.default.existsSync(migrateV2)) {
            const migrate = node_fs_1.default.readFileSync(migrateV2, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV3)) {
            const migrate = node_fs_1.default.readFileSync(migrateV3, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV4)) {
            const migrate = node_fs_1.default.readFileSync(migrateV4, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV5)) {
            const migrate = node_fs_1.default.readFileSync(migrateV5, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV6)) {
            const migrate = node_fs_1.default.readFileSync(migrateV6, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV7)) {
            const migrate = node_fs_1.default.readFileSync(migrateV7, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV8)) {
            const migrate = node_fs_1.default.readFileSync(migrateV8, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV9)) {
            const migrate = node_fs_1.default.readFileSync(migrateV9, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV10)) {
            const migrate = node_fs_1.default.readFileSync(migrateV10, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV11)) {
            const migrate = node_fs_1.default.readFileSync(migrateV11, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV12)) {
            const migrate = node_fs_1.default.readFileSync(migrateV12, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV13)) {
            const migrate = node_fs_1.default.readFileSync(migrateV13, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        if (node_fs_1.default.existsSync(migrateV14)) {
            const migrate = node_fs_1.default.readFileSync(migrateV14, "utf8");
            await runStatements(conn, splitStatements(migrate));
        }
        logger_js_1.logger.info("Schema applied successfully.");
        const [tables] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [config_js_1.config.db.database]);
        logger_js_1.logger.info(`Tables in ${config_js_1.config.db.database}: ${tables.map((t) => t.TABLE_NAME).join(", ")}`);
    }
    finally {
        await conn.end();
    }
}
main().catch((error) => {
    logger_js_1.logger.error("Schema apply failed", error);
    process.exit(1);
});
