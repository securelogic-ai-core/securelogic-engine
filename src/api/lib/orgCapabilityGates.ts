/**
 * orgCapabilityGates.ts — E-3: the per-organization dimension for the
 * env-global capability flags (C9 Part 3; sequenced before Stage-2 activation).
 *
 * THE MODEL. A capability is effective for a request only when BOTH dimensions
 * allow it:
 *
 *   effective = envFlag(capability) AND orgCapabilityAllows(orgId, capability)
 *
 * The env flag keeps exactly its current meaning (dark launch / kill switch,
 * per environment). This module adds the org dimension so that turning an env
 * flag on reaches only the orgs the operator intends — the design-partner
 * pilot model — instead of all tenants at once (promotion audit §4).
 *
 * MASTER FLAG. SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED, default OFF. Off means
 * this module answers "allow" for every org and every registered capability
 * WITHOUT touching the database — byte-identical behaviour to today. This is
 * the same additive rollout shape as the P9 dual-gate
 * (SECURELOGIC_CAPABILITY_GATING_ENABLED in corePlatformCapability.ts, a
 * DIFFERENT flag governing a different mechanism — do not conflate them).
 *
 * THE REGISTRY is the authority on valid keys (TDG-15: the table carries no
 * CHECK list, so a new capability never needs a migration). Each key declares
 * its no-row default:
 *
 *   "allow" — capabilities LIVE in production today. The org gate exists to
 *             remove the capability from one tenant (abuse, cost, incident),
 *             so absence of a row must preserve live behaviour.
 *   "deny"  — capabilities DARK everywhere in production. Explicit-grant-only:
 *             when the env flag flips on, only granted orgs receive the
 *             capability. A blanket "allow" default here would make Stage-2
 *             activation all-tenants-at-once again — the exact property E-3
 *             exists to remove — and pre-seeding deny rows races org signup.
 *
 * FAIL CLOSED, both ways a resolver can be wrong: an UNREGISTERED key answers
 * deny (a typo must never open a gate), and a LOOKUP ERROR answers deny (a
 * resolver fault is an entitlement fault). Both are logged.
 *
 * NOT WIRED (deliberately, to avoid the admin-ip-allowlist-unwired pattern of
 * a control that exists but enforces nothing): ask_provenance (consumed inside
 * the orchestrator, not at a route boundary) and voice (already governed
 * per-org by organizations.voice_input_enabled — a second control would
 * conflict, not compose). Register a key here ONLY in the same change that
 * enforces it.
 */

import type { Request, Response, NextFunction } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

export type OrgCapability =
  | "ask"
  | "ask_tools"
  | "ask_streaming"
  | "ask_actions"
  | "ask_governed";

/** No-row defaults. See the header for why the two classes differ. */
const ORG_CAPABILITY_DEFAULTS: Record<OrgCapability, "allow" | "deny"> = {
  // Live in production (kill-switch flag, default ON): absence of a row must
  // preserve the shipped behaviour.
  ask: "allow",
  // Dark in production (dark-launch flags, default OFF): explicit-grant-only,
  // so activation reaches only piloted orgs.
  ask_tools: "deny",
  ask_streaming: "deny",
  ask_actions: "deny",
  ask_governed: "deny",
};

export function orgCapabilityGatesEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED"] === "true";
}

/**
 * The org dimension of one capability. True when the org may use it, assuming
 * the env flag already allows it — callers AND the two dimensions.
 *
 * Master flag off → allow, zero queries. Explicit row → the row decides.
 * No row → the registry default. Unknown key or lookup error → deny.
 */
export async function orgCapabilityAllows(
  organizationId: string,
  capability: OrgCapability,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!orgCapabilityGatesEnabled(env)) return true;

  const fallback = ORG_CAPABILITY_DEFAULTS[capability];
  if (fallback === undefined) {
    // Unreachable through the type system, load-bearing at runtime: a caller
    // passing a key the registry doesn't carry must be refused, not admitted.
    logger.error(
      { event: "org_capability_unregistered", capability, organizationId },
      "org capability key is not in the registry — failing closed"
    );
    return false;
  }

  try {
    const r = await pg.query<{ enabled: boolean }>(
      `SELECT enabled FROM organization_capabilities
        WHERE organization_id = $1 AND capability = $2
        LIMIT 1`,
      [organizationId, capability]
    );
    if (r.rows.length === 0) return fallback === "allow";
    return r.rows[0]!.enabled === true;
  } catch (err) {
    logger.error(
      { event: "org_capability_lookup_failed", err, capability, organizationId },
      "org capability lookup failed — failing closed"
    );
    return false;
  }
}

/**
 * Route gate for one capability's org dimension. Mount AFTER
 * attachOrganizationContext (it needs organizationId) and alongside the
 * capability's env-flag gate, which keeps its current position and meaning.
 *
 * Denial is 404 with the exact askFeatureFlag body: a tenant refused a
 * capability learns nothing about whether the surface exists.
 */
export function requireOrgCapability(capability: OrgCapability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!orgCapabilityGatesEnabled()) {
      next();
      return;
    }

    const organizationId =
      (req as unknown as {
        organizationContext?: { organizationId?: string | null };
      }).organizationContext?.organizationId ?? null;

    if (!organizationId) {
      // Programming-error contract, same as requireEntitlement mounted without
      // context: this middleware is mounted after attachOrganizationContext,
      // so a missing context is a wiring defect, not a tenant state.
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    if (await orgCapabilityAllows(organizationId, capability)) {
      next();
      return;
    }

    res.status(404).json({ error: "not_found" });
  };
}
