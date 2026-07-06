/**
 * corePlatformCapability.ts — EAR P9 (Track C): the gating DUAL-GATE.
 *
 * The platform-correct access model is per-org capabilities (proven by the
 * ECL's `enterprise_context` capability, GATE A ruling); core domain routes
 * however still gate on `requireEntitlement("premium")`. This middleware
 * unifies them ADDITIVELY:
 *
 *   flag OFF (default) — delegates verbatim to requireEntitlement(minimum):
 *                        byte-identical behavior and denial bodies.
 *   flag ON            — entitlement leg first (unchanged); if it denies with
 *                        403, the org's `core_platform_capability` override
 *                        (20260809 column) may admit instead. When neither
 *                        admits, the ORIGINAL entitlement denial body is
 *                        replayed — the response vocabulary never changes.
 *
 * Unlike enterprise_context, the capability leg has NO entitlement-based
 * default: entitled orgs already pass the entitlement leg; the capability
 * exists purely to admit additional orgs by explicit operator grant.
 *
 * STOP GATE (P6-P11-ROADMAP.md P9): removing the entitlement leg — the real
 * commercial cutover — is a product decision reserved for Simmee. This module
 * must never grow that behavior without an explicit ruling.
 */

import type { Request, Response, NextFunction } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

export function capabilityGatingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_CAPABILITY_GATING_ENABLED"] === "true";
}

/** Explicit per-org grant only — NULL/FALSE both mean "entitlement leg decides". */
async function fetchCorePlatformGrant(organizationId: string): Promise<boolean> {
  const r = await pg.query<{ core_platform_capability: boolean | null }>(
    "SELECT core_platform_capability FROM organizations WHERE id = $1 LIMIT 1",
    [organizationId]
  );
  return r.rows[0]?.core_platform_capability === true;
}

type Captured = { status: number; body: unknown } | null;

/**
 * The dual-gate: requireEntitlement(minimum) OR the core_platform grant.
 * Mount wherever requireEntitlement("premium") is mounted today — AFTER
 * attachOrganizationContext.
 */
export function requireEntitlementOrCapability(
  minimum: Parameters<typeof requireEntitlement>[0]
) {
  const entitlementGate = requireEntitlement(minimum);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!capabilityGatingEnabled()) {
      entitlementGate(req, res, next);
      return;
    }

    // Probe the (synchronous) entitlement gate without touching the real res.
    let captured: Captured = null;
    let passed = false;
    const probe = {
      status(code: number) {
        captured = { status: code, body: undefined };
        return this;
      },
      json(body: unknown) {
        if (captured) captured.body = body;
        return this;
      }
    } as unknown as Response;
    entitlementGate(req, probe, () => {
      passed = true;
    });

    if (passed) {
      next();
      return;
    }

    const denial: Captured = captured ?? { status: 403, body: { error: "insufficient_entitlement" } };

    // Only a 403 entitlement denial is eligible for the capability leg; the
    // 401 missing-context denial replays as-is (programming-error contract).
    const orgId = (req as unknown as {
      organizationContext?: { organizationId?: string | null };
    }).organizationContext?.organizationId ?? null;

    if (denial.status === 403 && orgId) {
      try {
        if (await fetchCorePlatformGrant(orgId)) {
          next();
          return;
        }
      } catch (err) {
        logger.error(
          { event: "core_platform_capability_check_failed", err, orgId },
          "core_platform capability lookup failed — falling back to the entitlement denial"
        );
      }
    }

    res.status(denial.status).json(denial.body);
  };
}

/** The preconfigured gate the core-domain routes mount (premium OR grant). */
export const requirePremiumOrCorePlatform = requireEntitlementOrCapability("premium");
