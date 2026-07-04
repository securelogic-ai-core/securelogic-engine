/**
 * enterpriseContextCapability.ts — ECL access control (Priority-5 Item 9, AD-17).
 *
 * GATE A ruling (2026-07-04): access to Enterprise Context is CAPABILITY-based, not a
 * hard-coded tier check. `requireCapability("enterprise_context")` gates the ECL routes
 * (replacing requireEntitlement("premium")). The capability resolves from a per-org
 * override column with a Platform-plan default:
 *   - organizations.enterprise_context_capability = TRUE/FALSE  -> explicit per-org grant/deny
 *   - NULL -> Platform plans (Platform Professional + Enterprise) are granted by default;
 *             Brief tiers (Brief Pro / Brief Team) and starter are not.
 *
 * The feature flag (enterpriseContextFeatureFlag) is still the FIRST gate (404 when off);
 * this capability gate runs after attachOrganizationContext. Both must pass.
 */

import type { Request, Response, NextFunction } from "express";

import { pg } from "../infra/postgres.js";

/**
 * Raw entitlement values that receive the enterprise_context capability BY DEFAULT
 * (when the per-org override is NULL). Platform Professional (internal keys
 * platform / platform_annual) + Enterprise + the collapsed `premium` platform level.
 * Deliberately EXCLUDES the Brief tiers (professional = Brief Pro, teams/team =
 * Brief Team) and starter/standard — the operator can still grant those per-org.
 */
const PLATFORM_DEFAULT_ENTITLEMENTS: ReadonlySet<string> = new Set([
  "platform",
  "platform_annual",
  "premium",
  "enterprise"
]);

/**
 * Pure resolver: does this org have the enterprise_context capability?
 * `override` is the organizations.enterprise_context_capability value (true/false/null).
 * `entitlementLevel` is the raw org entitlement string (may be null).
 */
export function resolveEnterpriseContextCapability(
  entitlementLevel: string | null,
  override: boolean | null
): boolean {
  if (override !== null && override !== undefined) return override;
  const raw = typeof entitlementLevel === "string" ? entitlementLevel.toLowerCase().trim() : "";
  return PLATFORM_DEFAULT_ENTITLEMENTS.has(raw);
}

/** Fetch the per-org capability override. Explicit WHERE id — safe on the ambient pool. */
async function fetchCapabilityOverride(organizationId: string): Promise<boolean | null> {
  const r = await pg.query<{ enterprise_context_capability: boolean | null }>(
    "SELECT enterprise_context_capability FROM organizations WHERE id = $1 LIMIT 1",
    [organizationId]
  );
  return r.rows[0]?.enterprise_context_capability ?? null;
}

/**
 * Middleware factory. Mount AFTER attachOrganizationContext (needs organizationContext)
 * and after the feature-flag gate. Denies with 403 capability_required when the org
 * lacks the capability.
 */
export function requireCapability(capability: "enterprise_context") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ctx = (req as unknown as {
      organizationContext?: { organizationId: string; entitlementLevel: string | null };
    }).organizationContext;

    if (!ctx) {
      // Programming error: mounted without attachOrganizationContext upstream.
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    try {
      const override = await fetchCapabilityOverride(ctx.organizationId);
      if (resolveEnterpriseContextCapability(ctx.entitlementLevel, override)) {
        next();
        return;
      }
      res.status(403).json({ error: "capability_required", capability });
    } catch (err) {
      next(err);
    }
  };
}
