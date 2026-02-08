import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";

/**
 * Enterprise-grade HTTP logging
 *
 * Goals:
 * - NEVER leak secrets (Authorization, API keys, cookies)
 * - NEVER log request bodies
 * - Include requestId + latency
 * - Keep logs structured for SIEM ingestion
 * - Avoid logging querystrings (tokens can appear in URL params)
 */

const REDACT_KEYS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "req.headers.x-api-key",
  "req.headers.x-securelogic-key",
  "req.headers.x-admin-key",
  "req.headers.x-forwarded-for",

  // Common body secrets (we do NOT log body anyway, but defense-in-depth)
  "req.body.password",
  "req.body.pass",
  "req.body.secret",
  "req.body.token",
  "req.body.apiKey",
  "req.body.api_key",
  "req.body.access_token",
  "req.body.refresh_token",
  "req.body.client_secret",
  "req.body.private_key"
];

function safeString(input: unknown, maxLen: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function safeUserAgent(ua: unknown): string | null {
  return safeString(ua, 200);
}

function safeIp(ip: unknown): string | null {
  return safeString(ip, 80);
}

function safePathOnly(url: unknown): string {
  /**
   * Enterprise rule:
   * NEVER log querystrings.
   * Attackers will put secrets in ?token=... to poison logs.
   */
  if (typeof url !== "string") return "/";

  const idx = url.indexOf("?");
  if (idx === -1) return url;

  const pathOnly = url.slice(0, idx);
  return pathOnly.length ? pathOnly : "/";
}

export const httpLogger = pinoHttp({
  logger,

  /**
   * Hard rule: no automatic request body logging
   */
  serializers: {
    req(req) {
      return {
        requestId: (req as any).requestId ?? null,
        method: req.method,
        path: safePathOnly(req.url),
        route: (req as any).routerPath ?? null,

        /**
         * Express-safe IP sources:
         * - req.ip (trust proxy aware)
         * - req.socket.remoteAddress
         */
        ip: safeIp((req as any).ip ?? req.socket?.remoteAddress ?? null),

        userAgent: safeUserAgent(req.headers?.["user-agent"])
        // DO NOT include headers here. Redaction is not perfect across libs.
      };
    },

    res(res) {
      return {
        statusCode: res.statusCode
      };
    }
  },

  /**
   * Redaction layer (defense-in-depth)
   */
  redact: {
    paths: REDACT_KEYS,
    censor: "[REDACTED]"
  },

  /**
   * Enterprise-grade severity
   */
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  /**
   * Prevent noisy health checks from polluting logs
   */
  autoLogging: {
    ignore(req) {
      const path = safePathOnly(req.url);
      return path === "/health";
    }
  },

  /**
   * Structured message
   */
  customSuccessMessage(req, res) {
    return `${req.method} ${safePathOnly(req.url)} ${res.statusCode}`;
  },

  customErrorMessage(req, res, err) {
    return `${req.method} ${safePathOnly(req.url)} ${res.statusCode} ${err?.name ?? "Error"}`;
  },

  /**
   * Attach requestId everywhere
   */
  genReqId(req) {
    return (req as any).requestId ?? undefined;
  },

  /**
   * Custom properties
   */
  customProps(req, res) {
    return {
      requestId: (req as any).requestId ?? null,
      statusCode: res.statusCode
    };
  }
});