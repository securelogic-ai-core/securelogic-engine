/**
 * vendorPortalFeatureFlag.ts — the kill switch for the external trust boundary.
 *
 * This is the most consequential flag in the platform. It is the only one that
 * closes an UNAUTHENTICATED surface, and Stop Gate B requires demonstrating that
 * flipping it off 404s every portal route and invalidates every live session
 * with no data loss and no migration.
 *
 * Defaults OFF everywhere, including non-production. Every other flag in this
 * codebase that defaults on off-production does so because the surface is
 * internal and a developer needs it without ceremony
 * (vendorAssuranceFeatureFlag.ts returns true when NODE_ENV !== 'production').
 * That reasoning does not transfer here: an external write path should never be
 * open by accident on a shared dev box or a preview environment, and "it was on
 * by default in staging" is not a sentence anyone should have to say about the
 * portal.
 *
 * Off = 404 BEFORE any handler, any DB read, and — on the exchange route —
 * before a presented token is even hashed. 404 rather than 403 matches the
 * closed-route posture used elsewhere: a prober cannot learn the surface exists.
 *
 * Turning the flag off does NOT by itself revoke sessions; requirePortalSession
 * simply becomes unreachable. Operators killing the boundary in anger should
 * also run the mass revocation (one UPDATE on vendor_portal_sessions), which is
 * why that index exists.
 */

import type { NextFunction, Request, Response } from "express";

export function vendorPortalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_VENDOR_PORTAL_ENABLED"] === "true";
}

export function vendorPortalFeatureFlag(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!vendorPortalEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}
