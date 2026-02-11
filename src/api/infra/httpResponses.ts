import type { Response } from "express";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "unsupported_media_type"
  | "too_many_requests"
  | "internal_error"
  | "server_shutting_down"
  | "uri_too_long";

export type ErrorResponseBody = {
  error: ErrorCode;
  requestId?: string;
  details?: Record<string, unknown>;
};

function getRequestId(res: Response): string | null {
  const id = res.getHeader("X-Request-Id");
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

export function jsonError(
  res: Response,
  status: number,
  error: ErrorCode,
  details?: Record<string, unknown>
): void {
  const body: ErrorResponseBody = { error };

  const requestId = getRequestId(res);
  if (requestId !== null) {
    body.requestId = requestId;
  }

  if (details && Object.keys(details).length > 0) {
    body.details = details;
  }

  res.status(status).json(body);
}

export function badRequest(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 400, "bad_request", details);
}

export function unauthorized(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 401, "unauthorized", details);
}

export function forbidden(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 403, "forbidden", details);
}

export function notFound(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 404, "not_found", details);
}

export function unsupportedMediaType(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 415, "unsupported_media_type", details);
}

export function tooManyRequests(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 429, "too_many_requests", details);
}

export function uriTooLong(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 414, "uri_too_long", details);
}

export function internalError(
  res: Response,
  details?: Record<string, unknown>
): void {
  jsonError(res, 500, "internal_error", details);
}

export function serverShuttingDown(res: Response): void {
  jsonError(res, 503, "server_shutting_down");
}