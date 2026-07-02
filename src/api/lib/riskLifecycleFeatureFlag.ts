/**
 * riskLifecycleFeatureFlag.ts — Epic R1 feature flag.
 *
 * Gates the risk-lifecycle routes (src/api/routes/riskLifecycle.ts). When off,
 * every lifecycle route returns 404 BEFORE any handler, auth, or entitlement
 * check runs, so a probing caller cannot learn the surface exists — and no code
 * path touches existing risk behavior.
 *
 * DEFAULT OFF everywhere (including dev/test/prod). Unlike the vendor-assurance
 * flag, there is no `NODE_ENV !== 'production'` escape hatch: the strict
 * `=== "true"` predicate (the legacy-newsletter / daily-digest shape) is used so
 * the launch-critical risk surface stays byte-for-byte unchanged until an
 * operator explicitly enables the flag per service in render.yaml.
 *
 * Authority: docs/specs/risk-lifecycle-spec.md §9 + "Decisions (R1)".
 */

import type { Request, Response, NextFunction } from "express";

export function riskLifecycleEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] === "true";
}

/**
 * Express middleware. Short-circuits to a bare 404 when the flag is off,
 * mirroring the vendor-assurance closed-route posture. Apply as the FIRST
 * middleware on every lifecycle route, before requireApiKey.
 */
export function riskLifecycleFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!riskLifecycleEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
