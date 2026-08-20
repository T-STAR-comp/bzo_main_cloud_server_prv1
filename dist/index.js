"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const config_js_1 = require("./config.js");
const pool_js_1 = require("./db/pool.js");
const cors_js_1 = require("./middleware/cors.js");
const errorHandler_js_1 = require("./middleware/errorHandler.js");
const logger_js_1 = require("./logger.js");
const auth_js_1 = require("./routes/auth.js");
const account_js_1 = require("./routes/account.js");
const admin_js_1 = require("./routes/admin.js");
const flights_js_1 = require("./routes/flights.js");
const applications_js_1 = require("./routes/applications.js");
const adminApplications_js_1 = require("./routes/adminApplications.js");
const payments_js_1 = require("./routes/payments.js");
const public_js_1 = require("./routes/public.js");
const ensureAdmin_js_1 = require("./services/ensureAdmin.js");
const ensureSchemaPatches_js_1 = require("./services/ensureSchemaPatches.js");
const fileStorage_js_1 = require("./services/fileStorage.js");
const destinationFunFacts_js_1 = require("./services/destinationFunFacts.js");
const departureReminderScheduler_js_1 = require("./services/departureReminderScheduler.js");
const reportScheduler_js_1 = require("./services/reportScheduler.js");
const paymentPoller_js_1 = require("./services/paymentPoller.js");
const paymentReconciliation_js_1 = require("./services/paymentReconciliation.js");
const app = (0, express_1.default)();
app.set("trust proxy", 1);
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors_js_1.corsMiddleware);
app.use(express_1.default.json({ limit: "12mb" }));
app.use((0, cookie_parser_1.default)());
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again later." },
});
app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "biazo-server", timestamp: new Date().toISOString() });
});
app.use("/api/auth", authLimiter, auth_js_1.authRouter);
app.use("/api/account", account_js_1.accountRouter);
app.use("/api/admin", admin_js_1.adminRouter);
app.use("/api/flights", flights_js_1.flightsRouter);
app.use("/api/applications", applications_js_1.applicationsRouter);
app.use("/api/payments", payments_js_1.paymentsRouter);
app.use("/api/admin/applications", adminApplications_js_1.adminApplicationsRouter);
app.use("/api/public", public_js_1.publicRouter);
app.use(errorHandler_js_1.notFound);
app.use(errorHandler_js_1.errorHandler);
async function start() {
    await (0, pool_js_1.pingDatabase)();
    await (0, ensureSchemaPatches_js_1.ensureSchemaPatches)();
    await (0, fileStorage_js_1.ensureDataStore)();
    await (0, destinationFunFacts_js_1.ensureFunFactsSeeded)();
    await (0, ensureAdmin_js_1.ensureDefaultAdmin)();
    (0, paymentPoller_js_1.startPaymentPoller)();
    (0, paymentReconciliation_js_1.startPaymentReconciliation)();
    (0, reportScheduler_js_1.startReportScheduler)();
    (0, departureReminderScheduler_js_1.startDepartureReminderScheduler)();
    app.listen(config_js_1.config.port, () => {
        logger_js_1.logger.info(`Biazo API listening on http://localhost:${config_js_1.config.port}`);
        logger_js_1.logger.info(`CORS allowed origins: ${config_js_1.config.clientOrigins.join(", ")}`);
    });
}
start().catch((error) => {
    logger_js_1.logger.error("Failed to start server", error);
    process.exit(1);
});
