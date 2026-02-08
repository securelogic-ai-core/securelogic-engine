import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),

  timestamp: pino.stdTimeFunctions.isoTime,

  /**
   * Enterprise-grade secret redaction.
   * This is defense-in-depth: we also avoid logging these fields at all.
   */
  redact: {
    paths: [
      // Authorization & cookies
      "req.headers.authorization",
      "req.headers.Authorization",
      "req.headers.cookie",
      "req.headers.Cookie",
      "req.headers['set-cookie']",
      "req.headers['Set-Cookie']",

      // API keys
      "req.headers['x-api-key']",
      "req.headers['X-Api-Key']",
      "req.headers['X-API-Key']",
      "req.headers['x-securelogic-key']",
      "req.headers['X-Securelogic-Key']",
      "req.headers['x-admin-key']",
      "req.headers['X-Admin-Key']",

      // Common body secret patterns
      "req.body.password",
      "req.body.pass",
      "req.body.secret",
      "req.body.token",
      "req.body.apiKey",
      "req.body.api_key",
      "req.body.access_token",
      "req.body.refresh_token",
      "req.body.client_secret",
      "req.body.private_key",

      // Generic log objects (in case something passes them through)
      "*.password",
      "*.secret",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.client_secret",
      "*.private_key"
    ],
    censor: "[REDACTED]"
  },

  /**
   * No PID/hostname noise in serverless/container logs
   */
  base: {
    service: "securelogic-engine",
    env: process.env.NODE_ENV ?? "development"
  },

  /**
   * Strong defaults for production logging
   */
  formatters: {
    level(label) {
      return { level: label };
    }
  },

  /**
   * Avoid crashing if something tries to log BigInt
   */
  serializers: {
    err: pino.stdSerializers.err
  }
});