"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function stamp() {
    return new Date().toISOString();
}
function write(level, message, meta) {
    const prefix = `[${stamp()}] [${level.toUpperCase()}]`;
    if (meta !== undefined) {
        console[level === "error" ? "error" : "log"](prefix, message, meta);
    }
    else {
        console[level === "error" ? "error" : "log"](prefix, message);
    }
}
exports.logger = {
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
};
