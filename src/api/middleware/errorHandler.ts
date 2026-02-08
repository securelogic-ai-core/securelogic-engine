import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

const MAX_ID_LEN = 128;

function safeTrimString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

function getRequestId(req: Request): string | null {
  const id =
    (req as any).requestId ??
    (req.headers["x-request-id"] as string | undefined) ??
    null;

  return safeTrimString(id, MAX_ID_LEN);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

type NormalizedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string;
};

function normalizeError(err: unknown): NormalizedError {
  /**
   * Enterprise rule:
   * Never trust err shape.
   * Never assume message is safe.
   */
  if (err instanceof Error) {
    const anyErr = err as any;

    const name = safeTrimString(err.name, 80) ?? "Error";
    const message = safeTrimString(err.message, 300) ?? "unknown_error";

    const out: NormalizedError = { name, message };

    if (typeof err.stack === "string" && err.stack.trim().length > 0) {
      out.stack = err.stack;
    }

    if (typeof anyErr.code === "string") {
      const code = safeTrimString(anyErr.code, 80);
      if (code) out.code = code;
    }

    return out;
  }

  if (typeof err === "string") {
    return {
      name: "ThrownString",
      message: safeTrimString(err, 300) ?? "unknown_error"
    };
  }

  if (isPlainObject(err)) {
    const name = safeTrimString(err["name"], 80) ?? "UnknownError";
    const message = safeTrimString(err["message"], 300) ?? "unknown_error";

    const out: NormalizedError = { name, message };

    const code = safeTrimString(err["code"], 80);
    if (code) out.code = code;

    return out;
  }

  return {
    name: "UnknownError",
    message: "unknown_error"
  };
}

/**
 * Global error handler (Enterprise-grade)
 *
 * RULES:
 * - Must be last middleware
 * - Never leaks stack traces to clients
 * - Never logs secrets (avoid dumping req headers/body)
 * - In production: do NOT log stack traces by default
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  /**
   * If response already started, we cannot safely write JSON.
   */
  if (res.headersSent) return;

  const requestId = getRequestId(req);
  const normalized = normalizeError(err);

  const statusCode = 500;
  const isDev = process.env.NODE_ENV === "development";

  /**
   * Enterprise logging rules:
   * - In prod: no stack by default
   * - In dev: include stack for debugging
   */
  const errForLog: NormalizedError = isDev
    ? normalized
    : {
        name: normalized.name,
        message: normalized.message,
        ...(normalized.code ? { code: normalized.code } : {})
      };

  logger.error(
    {
      event: "unhandled_request_error",
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      err: errForLog
    },
    "Unhandled request error"
  );

  res.status(statusCode).json({
    error: "internal_server_error",
    requestId
  });
}