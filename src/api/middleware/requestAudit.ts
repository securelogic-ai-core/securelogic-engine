import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";
import { pgElevated } from "../infra/postgres.js";

/**
 * writeAuditLog — fire-and-forget Postgres write.
 * Never throws; a DB failure must never block the request.
 */
function writeAuditLog(
  req: Request,
  res: Response,
  startMs: number
): void {
  const apiKey = (req as any).apiKey as Record<string, unknown> | undefined;

  if (!apiKey) return;

  const organizationId =
    typeof apiKey.organization_id === "string" ? apiKey.organization_id : null;
  const apiKeyId =
    typeof apiKey.id === "string" ? apiKey.id : null;
  const actorLabel =
    typeof apiKey.label === "string" ? apiKey.label : null;
  const requestId =
    (req as any).requestId ?? req.get("x-request-id") ?? null;

  // RLS adoption (A04-G1 gap C', PR-C2): writes go through pgElevated (owner
  // pool, outside any tenant scope). audit_log is cross-tenant and org-nullable
  // (organizationId falls back to null when the api_key carries no org), and
  // this fires on res.finish for every authenticated request — there is no
  // withTenant(orgId) scope here. Tier B grant (SELECT, INSERT) applies
  // post-flip. The fail-open .catch below is unchanged.
  pgElevated.query(
    `
    INSERT INTO audit_log
      (organization_id, api_key_id, actor_type, actor_label,
       action, method, route, status_code, request_id, duration_ms)
    VALUES ($1, $2, 'api_key', $3, 'api_call', $4, $5, $6, $7, $8)
    `,
    [
      organizationId,
      apiKeyId,
      actorLabel,
      req.method,
      req.originalUrl,
      res.statusCode,
      requestId,
      Date.now() - startMs
    ]
  ).catch((err) => {
    logger.warn(
      { event: "audit_log_write_failed", err },
      "audit_log write failed (fail-open)"
    );
  });
}

/**
 * requestAudit — global audit middleware.
 *
 * Responsibility: write a durable Postgres audit record after each
 * authenticated request completes. The write fires on res.finish so
 * it captures the final status code and duration.
 *
 * Fail-open: a failed audit write must never block the response.
 *
 * Redis-based usage metering is intentionally NOT done here.
 * Metering belongs in enforceUsageCap / tierRateLimit, which run
 * after requireApiKey when req.apiKey is available.
 */
export function requestAudit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startMs = Date.now();

  res.on("finish", () => {
    writeAuditLog(req, res, startMs);
  });

  next();
}