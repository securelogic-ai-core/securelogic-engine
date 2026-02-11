import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";
import { internalError } from "../infra/httpResponses.js";

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
  // Enterprise rule: never trust err shape, ever.
  if (err instanceof Error) {
    const anyErr = err as any;

    const name = safeTrimString(err.name, 80) ?? "Error";
    const message = safeTrimString(err.message, 300) ?? "unknown_error";

    const out: NormalizedError = { name, message };

    if (typeof err.stack === "string" && err.stack.trim().length > 0) {
      out.stack = err.stack;
    }

    const code = safeTrimString(anyErr?.code, 80);
    if (code) out.code = code;

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
 * - In production: no stack traces by default
 * - Response body MUST follow src/api/infra/httpResponses.ts contract
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // If response already started, Express expects us to delegate.
  // But we can't safely write JSON at this point.
  if (res.headersSent) return;

  const requestId = getRequestId(req);
  const normalized = normalizeError(err);

  const isDev = process.env.NODE_ENV === "development";

  const errForLog: NormalizedError = isDev
    ? normalized
    : {
        name: normalized.name,
        message: normalized.message,
        ...(normalized.code ? { code: normalized.code } : {})
      };

  try {
    logger.error(
      {
        event: "unhandled_request_error",
        requestId,
        method: req.method,
        path: req.originalUrl,
        err: errForLog
      },
      "Unhandled request error"
    );
  } catch {
    // Last-ditch fallback: never throw from the error handler.
    console.error("Unhandled request error (logger failed):", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      err: errForLog
    });
  }

  // MUST align to ErrorCode union + jsonError() contract.
  internalError(res);
}