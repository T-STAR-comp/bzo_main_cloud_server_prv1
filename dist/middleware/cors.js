"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsMiddleware = exports.corsOptions = void 0;
const cors_1 = __importDefault(require("cors"));
const config_js_1 = require("../config.js");
const logger_js_1 = require("../logger.js");
const allowedOrigins = new Set(config_js_1.config.clientOrigins);
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    return allowedOrigins.has(origin);
}
exports.corsOptions = {
    origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
            return;
        }
        logger_js_1.logger.warn(`CORS blocked request from origin: ${origin}`);
        callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
    maxAge: config_js_1.config.isProd ? 86_400 : 600,
};
exports.corsMiddleware = (0, cors_1.default)(exports.corsOptions);
