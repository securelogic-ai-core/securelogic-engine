import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { scopeFromRequest } from "../lib/seatScope.js";
import { seatModelEnabled } from "../middleware/requireSeat.js";

const router = Router();

/* =========================================================
   GET /api/me

   Returns the calling API key's account status — entitlement
   level, org details, and whether billing is active.

   No entitlement gate: free-tier callers must be able to
   inspect their own status (e.g. to confirm an upgrade worked).

   Never exposes key_hash, stripe_customer_id, or revoked_at.
   ========================================================= */

router.get("/me", requireApiKey, attachOrganizationContext, async (req, res, next) => {
  try {
    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const orgId = typeof apiKey.organization_id === "string"
      ? apiKey.organization_id
      : null;

    if (!orgId) {
      res.status(500).json({ error: "account_context_missing" });
      return;
    }

    const result = await pg.query(
      `
      SELECT
        o.id                         AS organization_id,
        o.name                       AS organization_name,
        o.slug                       AS organization_slug,
        o.plan                       AS organization_plan,
        o.status                     AS organization_status,
        o.entitlement_level          AS entitlement_level,
        o.stripe_subscription_tier   AS stripe_subscription_tier,
        o.payment_failed_at          AS payment_failed_at,
        k.id                         AS api_key_id,
        k.label                      AS api_key_label,
        k.status                     AS api_key_status,
        k.last_used_at,
        k.created_at                 AS api_key_created_at
      FROM api_keys k
      JOIN organizations o ON o.id = k.organization_id
      WHERE k.id = $1
      LIMIT 1
      `,
      [apiKey.id]
    );

    const row = result.rows[0];

    if (!row) {
      res.status(404).json({ error: "account_not_found" });
      return;
    }

    const entitlementLevel = String(row.entitlement_level ?? "starter");
    // Same semantics as GET /api/auth/me (customerAuth.ts): a paying org with a
    // failed payment is NOT billing-active. The /account "Payment failed" banner
    // keys off billingActive === false && entitlement !== starter — with the old
    // paid-tier-only definition here that condition was unsatisfiable, so the
    // banner could never render during Stripe's retry/grace window.
    const billingActive = entitlementLevel !== "starter" && !row.payment_failed_at;

    // The resolved seat scope — the SAME resolveScope the server enforces with,
    // so the client drives navigation and affordances from one source of truth
    // (defense in depth; the server remains authoritative). `enforced` tells the
    // UI whether the seat model is live in this environment.
    const scope = scopeFromRequest(req as unknown as Parameters<typeof scopeFromRequest>[0]);
    const seat = {
      seatType: scope.seatType,
      role: scope.effectiveRole,
      isAdmin: scope.isAdmin,
      readScope: scope.readScope,
      writeScope: scope.writeScope,
      capabilities: [...scope.capabilities],
      enforced: seatModelEnabled(),
    };

    res.json({
      seat,
      organizationId:     row.organization_id,
      organizationName:   row.organization_name,
      organizationSlug:   row.organization_slug,
      organizationPlan:   row.organization_plan,
      organizationStatus: row.organization_status,
      apiKeyId:           row.api_key_id,
      apiKeyLabel:        row.api_key_label,
      apiKeyStatus:       row.api_key_status,
      entitlementLevel,
      stripeSubscriptionTier: row.stripe_subscription_tier ?? null,
      billingActive,
      lastUsedAt:         row.last_used_at,
      apiKeyCreatedAt:    row.api_key_created_at
    });
  } catch (err) {
    logger.error({ event: "me_failed", err }, "GET /api/me failed");
    next(err);
  }
});

export default router;
