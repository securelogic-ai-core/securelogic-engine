/**
 * assetAutoCreateFlag.ts — kill switch for PLAT-ASSET-1 automatic asset
 * creation and its review-queue surface.
 *
 * Default-DENY (=== "true"), everywhere including non-production, for the
 * same reason scan ingestion itself is: this capability CREATES canonical
 * assets at import scale, and a capability that can add rows to a customer's
 * estate must never be open by accident.
 *
 * Auto-creation additionally requires SECURELOGIC_ASSET_REGISTRY_ENABLED at
 * the call site (assetAutoCreation.ts): createDetailAsset's documented
 * invariant is that detail rows are only ever created where the registry is
 * enabled, and this lane keeps that invariant rather than becoming its first
 * exception.
 *
 * DELIBERATELY NOT DECLARED IN render.yaml ON THIS BRANCH: the R-1 flag
 * reconciliation (§G) is release evidence over the frozen candidate, and a
 * render.yaml production-block edit invalidates it. Declare the key (value
 * "false") in IaC at merge time, after the boundary reopens — the resolver
 * below makes undeclared and "false" identical: dark by construction.
 */
import type { NextFunction, Request, Response } from "express";

export function assetAutoCreateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"] === "true";
}

/** 404 when off — the surface is indistinguishable from absent. */
export function assetAutoCreateFeatureFlag(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!assetAutoCreateEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
