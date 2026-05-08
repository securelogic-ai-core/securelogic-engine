/**
 * vendorAssuranceFeatureFlag.ts — Phase 1 feature flag.
 *
 * Mirrors the industry-templates pattern (see templateLoader.industryTemplatesEnabled).
 * The flag controls whether the vendor-assurance routes are reachable at all.
 * When off, every route in src/api/routes/vendorAssuranceDocuments.ts returns 404
 * BEFORE any handler logic runs — same shape as the existing closed-route
 * pattern in the codebase.
 *
 * Activation rules:
 *   - SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true     → enabled
 *   - any other value with NODE_ENV=production       → disabled (production stays
 *                                                      off in this package)
 *   - NODE_ENV !== 'production'                      → enabled (dev/test default)
 *
 * Phase 1 sets the flag in the staging engine block of render.yaml only.
 * Production engine has no R2 wired (Phase 0 stop point) and no flag set.
 */

import type { Request, Response, NextFunction } from "express";

export function vendorAssuranceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] === "true") return true;
  if (env["NODE_ENV"] !== "production") return true;
  return false;
}

/**
 * Express middleware. Short-circuits to 404 with no body details when the
 * feature flag is off so a probing caller cannot learn that the surface
 * exists. Mirrors the cross-org-returns-404 posture used elsewhere.
 */
export function vendorAssuranceFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!vendorAssuranceEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
