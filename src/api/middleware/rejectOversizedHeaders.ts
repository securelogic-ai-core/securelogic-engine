import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * rejectOversizedHeaders (Enterprise-grade)
 *
 * PURPOSE:
 * Hard-block requests with absurdly large headers to prevent:
 * - memory pressure / GC churn
 * - reverse proxy amplification
 * - slowloris-style edge abuse
 * - log amplification attacks
 *
 * NOTES:
 * - Express does not provide a built-in hard limit at middleware level.
 * - This is defense-in-depth. Your proxy (Render/Nginx/Cloudflare) should also enforce limits.
 * - We measure raw header byte size using Buffer.byteLength.
 */

const MAX_TOTAL_HEADER_BYTES = 16 * 1024; // 16KB total header budget
const MAX_SINGLE_HEADER_BYTES = 8 * 1024; // 8KB for any single header

function safeString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v;
}

function headerByteSize(key: string, value: unknown): number {
  const k = safeString(key);
  const v = safeString(value);
  return Buffer.byteLength(k, "utf8") + Buffer.byteLength(v, "utf8");
}

export function rejectOversizedHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  let total = 0;

  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const part of v) {
        const bytes = headerByteSize(k, part);

        if (bytes > MAX_SINGLE_HEADER_BYTES) {
          logger.warn(
            {
              event: "blocked_oversized_header",
              header: k,
              headerBytes: bytes,
              maxSingleBytes: MAX_SINGLE_HEADER_BYTES,
              method: req.method,
              route: req.path
            },
            "Blocked request with oversized header (array part)"
          );

          res.status(431).json({ error: "request_header_fields_too_large" });
          return;
        }

        total += bytes;
      }
    } else {
      const bytes = headerByteSize(k, v);

      if (bytes > MAX_SINGLE_HEADER_BYTES) {
        logger.warn(
          {
            event: "blocked_oversized_header",
            header: k,
            headerBytes: bytes,
            maxSingleBytes: MAX_SINGLE_HEADER_BYTES,
            method: req.method,
            route: req.path
          },
          "Blocked request with oversized header"
        );

        res.status(431).json({ error: "request_header_fields_too_large" });
        return;
      }

      total += bytes;
    }

    if (total > MAX_TOTAL_HEADER_BYTES) {
      logger.warn(
        {
          event: "blocked_oversized_headers_total",
          totalHeaderBytes: total,
          maxTotalBytes: MAX_TOTAL_HEADER_BYTES,
          method: req.method,
          route: req.path
        },
        "Blocked request with oversized total headers"
      );

      res.status(431).json({ error: "request_header_fields_too_large" });
      return;
    }
  }

  next();
}
