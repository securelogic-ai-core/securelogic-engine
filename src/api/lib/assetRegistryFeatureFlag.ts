/**
 * assetRegistryFeatureFlag.ts — Enterprise Asset Registry feature flag.
 *
 * Gates the registry routes (src/api/routes/assets.ts). When off, every registry
 * route returns 404 BEFORE any handler, auth, or capability check runs, so a
 * probing caller cannot learn the surface exists — and no code path touches
 * existing behavior. Phase 0 ships only a read-only SQL view + one read route,
 * so with the flag off the entire feature is byte-for-byte inert.
 *
 * DEFAULT OFF everywhere (including dev/test/prod). Strict `=== "true"` predicate
 * (the ECL / risk-lifecycle shape) — no `NODE_ENV` escape hatch. Prod enablement
 * is out of scope for the EAR workstream (GATE B posture, same as the ECL flag).
 *
 * Authority: docs/architecture/enterprise-asset-registry/ARCHITECTURE.md §4
 * (Phase 0); docs/validation/enterprise-asset-registry-tracker.md.
 */

import type { Request, Response, NextFunction } from "express";

export function assetRegistryEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_ASSET_REGISTRY_ENABLED"] === "true";
}

/**
 * Express middleware. Short-circuits to a bare 404 when the flag is off. Apply as
 * the FIRST middleware on every asset-registry route, before requireApiKey.
 */
export function assetRegistryFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!assetRegistryEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
