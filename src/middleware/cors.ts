import cors from "cors";
import type { CorsOptions } from "cors";
import { config } from "../config.js";
import { logger } from "../logger.js";

const allowedOrigins = new Set(config.clientOrigins);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    logger.warn(`CORS blocked request from origin: ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
  maxAge: config.isProd ? 86_400 : 600,
};

export const corsMiddleware = cors(corsOptions);
