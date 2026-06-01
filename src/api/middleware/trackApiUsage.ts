import type { Request, Response, NextFunction } from "express";
import { pg, withTenant } from "../infra/postgres.js";

/**
 * trackApiUsage — fire-and-forget daily usage recorder.
 *
 * Calls next() immediately (non-blocking). UPSERTs a daily request count
 * into api_usage_daily after the request is handed off. Never throws and
 * never delays the response.
 *
 * Requires requireApiKey to have run first (populates req.apiKey).
 * organizationContext may or may not be set depending on route order;
 * falls back to jwtPayload.org when absent.
 */
export function trackApiUsage(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  next();

  const apiKey = (req as any).apiKey as Record<string, unknown> | undefined;
  const orgCtx = (req as any).organizationContext as
    | { organizationId: string | null }
    | undefined;
  const orgId: string | null =
    (orgCtx?.organizationId ?? null) ||
    ((req as any).jwtPayload?.org as string | undefined) ||
    null;

  if (!apiKey || typeof apiKey.id !== "string" || !orgId) return;

  const today = new Date().toISOString().slice(0, 10);

  // RLS adoption (A04-G1 gap C'): scope the UPSERT to the org so it routes
  // through the tenant client after the app_request flip. orgId is guaranteed
  // non-null by the guard above. Fire-and-forget — the void/.catch keeps it
  // non-blocking and swallows failures exactly as before.
  void withTenant(orgId, async () => {
    await pg.query(
      `INSERT INTO api_usage_daily
         (organization_id, api_key_id, date, request_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (api_key_id, date)
       DO UPDATE SET
         request_count = api_usage_daily.request_count + 1,
         updated_at    = NOW()`,
      [orgId, apiKey.id, today]
    );
  }).catch(() => {
    // silent — usage tracking must never block or fail a request
  });
}
