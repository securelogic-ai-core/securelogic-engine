import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),

  timestamp: pino.stdTimeFunctions.isoTime,

  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.Authorization",
      "req.headers['x-api-key']",
      "req.headers['X-API-Key']"
    ],
    remove: true
  },

  base: {
    service: "securelogic-api",
    env: process.env.NODE_ENV ?? "development"
  }
});