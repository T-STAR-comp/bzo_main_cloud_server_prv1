import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.js";
import { pingDatabase } from "./db/pool.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { logger } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { adminRouter } from "./routes/admin.js";
import { flightsRouter } from "./routes/flights.js";
import { applicationsRouter } from "./routes/applications.js";
import { adminApplicationsRouter } from "./routes/adminApplications.js";
import { paymentsRouter } from "./routes/payments.js";
import { publicRouter } from "./routes/public.js";
import { ensureDefaultAdmin } from "./services/ensureAdmin.js";
import { ensureSchemaPatches } from "./services/ensureSchemaPatches.js";
import { ensureDataStore } from "./services/fileStorage.js";
import { ensureFunFactsSeeded } from "./services/destinationFunFacts.js";
import { startDepartureReminderScheduler } from "./services/departureReminderScheduler.js";
import { startReportScheduler } from "./services/reportScheduler.js";
import { startPaymentPoller } from "./services/paymentPoller.js";
import { startPaymentReconciliation } from "./services/paymentReconciliation.js";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(corsMiddleware);
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "biazo-server", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/account", accountRouter);
app.use("/api/admin", adminRouter);
app.use("/api/flights", flightsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin/applications", adminApplicationsRouter);
app.use("/api/public", publicRouter);

app.use(notFound);
app.use(errorHandler);

async function start() {
  await pingDatabase();
  await ensureSchemaPatches();
  await ensureDataStore();
  await ensureFunFactsSeeded();
  await ensureDefaultAdmin();
  startPaymentPoller();
  startPaymentReconciliation();
  startReportScheduler();
  startDepartureReminderScheduler();
  app.listen(config.port, () => {
    logger.info(`Biazo API listening on http://localhost:${config.port}`);
    logger.info(`CORS allowed origins: ${config.clientOrigins.join(", ")}`);
  });
}

start().catch((error) => {
  logger.error("Failed to start server", error);
  process.exit(1);
});
