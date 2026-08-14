"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDataStore = ensureDataStore;
exports.ticketStoragePath = ticketStoragePath;
exports.saveTicketFile = saveTicketFile;
exports.readStoredFile = readStoredFile;
exports.loadTicketFileContent = loadTicketFileContent;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../logger.js");
function resolveStorePath(relativePath) {
    const root = path_1.default.resolve(process.cwd(), config_js_1.config.dataStorePath);
    const abs = path_1.default.resolve(root, relativePath);
    if (!abs.startsWith(root + path_1.default.sep) && abs !== root) {
        throw new Error("Invalid storage path");
    }
    return abs;
}
async function ensureDataStore() {
    const root = path_1.default.resolve(process.cwd(), config_js_1.config.dataStorePath);
    await promises_1.default.mkdir(path_1.default.join(root, "tickets"), { recursive: true });
    logger_js_1.logger.info(`Data store ready at ${root}`);
}
function ticketStoragePath(applicationId, ticketId, fileName) {
    const ext = path_1.default.extname(fileName) || ".bin";
    const safeName = `${ticketId}${ext}`;
    return `tickets/${applicationId}/${safeName}`;
}
async function saveTicketFile(applicationId, ticketId, fileName, buffer) {
    const relativePath = ticketStoragePath(applicationId, ticketId, fileName);
    const abs = resolveStorePath(relativePath);
    await promises_1.default.mkdir(path_1.default.dirname(abs), { recursive: true });
    await promises_1.default.writeFile(abs, buffer);
    return relativePath;
}
async function readStoredFile(relativePath) {
    return promises_1.default.readFile(resolveStorePath(relativePath));
}
async function loadTicketFileContent(row) {
    const r = row;
    if (r.file_path) {
        return readStoredFile(r.file_path);
    }
    if (r.file_data) {
        return Buffer.isBuffer(r.file_data) ? r.file_data : Buffer.from(r.file_data);
    }
    throw new Error("Ticket file not found");
}
