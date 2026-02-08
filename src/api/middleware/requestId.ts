import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const MAX_REQUEST_ID_LENGTH = 128;

function safeRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.length > MAX_REQUEST_ID_LENGTH) return null;

  // Strictly allow safe characters only (prevents log injection)
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return null;

  return trimmed;
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  /**
   * Enterprise rule:
   * Never mutate req.headers (Express types allow it, but it’s unsafe + confusing).
   *
   * Instead:
   * - store on req object
   * - set response header
   */
  const incoming = safeRequestId(req.get("x-request-id"));

  const id = incoming ?? randomUUID();

  (req as any).requestId = id;
  res.setHeader("x-request-id", id);

  next();
}