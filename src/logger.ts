type LogLevel = "info" | "warn" | "error";

function stamp() {
  return new Date().toISOString();
}

function write(level: LogLevel, message: string, meta?: unknown) {
  const prefix = `[${stamp()}] [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    console[level === "error" ? "error" : "log"](prefix, message, meta);
  } else {
    console[level === "error" ? "error" : "log"](prefix, message);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};
