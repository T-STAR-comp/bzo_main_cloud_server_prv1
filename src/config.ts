import dotenv from "dotenv";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";

/** Use env value when set (including empty string). In dev, fall back to defaults. */
function env(name: string, devDefault?: string): string {
  const value = process.env[name];
  if (value !== undefined) return value;
  if (!isProd && devDefault !== undefined) return devDefault;
  throw new Error(`Missing environment variable: ${name}`);
}

const DEV_JWT_ACCESS =
  "dev-biazo-access-secret-do-not-use-in-production-0123456789abcdef";
const DEV_JWT_REFRESH =
  "dev-biazo-refresh-secret-do-not-use-in-production-0123456789abcdef";

const DEV_CLIENT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function parseClientOrigins(): string[] {
  const raw = process.env.CLIENT_ORIGIN?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  if (!isProd) return DEV_CLIENT_ORIGINS;
  throw new Error("Missing environment variable: CLIENT_ORIGIN");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: env("DB_USER", "root"),
    password: env("DB_PASSWORD", ""),
    database: env("DB_NAME", "biazo_travel"),
  },
  jwt: {
    accessSecret: env("JWT_ACCESS_SECRET", DEV_JWT_ACCESS),
    refreshSecret: env("JWT_REFRESH_SECRET", DEV_JWT_REFRESH),
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
    refreshTtl: process.env.REFRESH_TOKEN_TTL ?? "7d",
  },
  clientOrigins: parseClientOrigins(),
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.EMAIL_FROM ?? "Biazo Travel <noreply@biazo.mw>",
  },
  admin: {
    username: process.env.ADMIN_USERNAME ?? "admin",
    email: process.env.ADMIN_EMAIL ?? "admin@biazo.mw",
    defaultPassword: process.env.ADMIN_DEFAULT_PASSWORD ?? "password",
  },
  paychangu: {
    secretKey: process.env.PAYCHANGU_SECRET_KEY ?? "",
    baseUrl: process.env.PAYCHANGU_BASE_URL ?? "https://api.paychangu.com",
    webhookSecret: process.env.PAYCHANGU_WEBHOOK_SECRET ?? "",
    checkoutMode: (process.env.PAYCHANGU_CHECKOUT_MODE ?? "direct") as "direct" | "hosted",
  },
  /** When false, flight ticket payments use manual bank transfer instead of PayChangu. */
  usePaymentGateway: process.env.USE_PAYMENT_GATEWAY !== "false",
  dataStorePath: process.env.DATA_STORE_PATH ?? "data_store_biazo",
  isProd,
};
