/**
 * enterpriseContextFeatureFlag.ts — Enterprise Context Layer (ECL) feature flag.
 *
 * Gates the ECL routes (src/api/routes/enterpriseEntities.ts). When off, every
 * ECL route returns 404 BEFORE any handler, auth, or entitlement check runs, so
 * a probing caller cannot learn the surface exists — and no code path touches
 * existing behavior. The tables ship inert (RLS NOT FORCE) and empty.
 *
 * DEFAULT OFF everywhere (including dev/test/prod). The strict `=== "true"`
 * predicate (the risk-lifecycle / legacy-newsletter shape) is used — there is no
 * `NODE_ENV` escape hatch — so the launch-critical ECL surface stays byte-for-byte
 * inert until an operator explicitly enables the flag per service in render.yaml.
 *
 * ⚠ Commercial caveat (see ENTERPRISE_CONTEXT_ARCHITECTURE.md §24 Q2 / AD-17):
 * requireEntitlement collapses Team / Platform / Platform-Annual / Enterprise all
 * to `premium` (rank 4), so with this flag ON the ECL routes reach EVERY rank-4
 * org, not only Enterprise. Do NOT enable in production until the AD-17 per-org
 * capability grant ships to gate Enterprise-vs-Platform.
 *
 * Authority: BUILD_SEQUENCE.md Priority-5 Slice-1;
 * docs/architecture/enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md.
 */

import type { Request, Response, NextFunction } from "express";

export function enterpriseContextEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED"] === "true";
}

/**
 * Express middleware. Short-circuits to a bare 404 when the flag is off. Apply as
 * the FIRST middleware on every ECL route, before requireApiKey.
 */
export function enterpriseContextFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!enterpriseContextEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
