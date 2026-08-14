"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.notFound = notFound;
exports.errorHandler = errorHandler;
exports.asyncHandler = asyncHandler;
const zod_1 = require("zod");
const logger_js_1 = require("../logger.js");
class AppError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.AppError = AppError;
function notFound(_req, res) {
    res.status(404).json({ error: "Not found" });
}
function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        res.status(err.status).json({ error: err.message });
        return;
    }
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.flatten() });
        return;
    }
    logger_js_1.logger.error("Unhandled error", err);
    res.status(500).json({ error: "Internal server error" });
}
function asyncHandler(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
