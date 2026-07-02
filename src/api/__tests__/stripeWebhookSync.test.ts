import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Source-shape tests for the Stripe webhook entitlement sync.
 *
 * The internal helpers (resolveOrgIdForEvent, syncOrgEntitlement,
 * handlePaymentFailed) are not exported; the codebase has no live-server
 * test harness. These tests assert the structural invariants of the
 * rewrite: that organizations is the sole write target for entitlement,
 * that org resolution prefers stripe_customer_id over api_key_id, and
 * that the stale-revoke guard fires only on .deleted events.
 */

const FILE = resolve(__dirname, "../webhooks/stripeWebhook.ts");
const SOURCE = readFileSync(FILE, "utf8");

describe("stripeWebhook.ts: write target invariants", () => {
  it("does not UPDATE api_keys.entitlement_level", () => {
    // Old bug surface: webhook wrote to api_keys.entitlement_level via
    // WHERE id = $apiKeyId, which only updated one key per org.
    expect(SOURCE).not.toMatch(/UPDATE api_keys[\s\n]+SET[\s\n]+entitlement_level/);
  });

  it("UPDATEs organizations.entitlement_level (the new source of truth)", () => {
    expect(SOURCE).toMatch(/UPDATE organizations[\s\n]+SET[\s\n]+entitlement_level/);
  });

  it("UPDATEs organizations.payment_failed_at on invoice.payment_failed (not api_keys)", () => {
    // The handlePaymentFailed handler keys by stripe_customer_id and writes
    // to the organizations row.
    expect(SOURCE).toMatch(/UPDATE organizations[\s\S]*?payment_failed_at/);
    expect(SOURCE).not.toMatch(
      /UPDATE api_keys[\s\n]+SET[\s\n]+payment_failed_at = NOW\(\)\s*\n?\s*WHERE stripe_customer_id/
    );
  });

  it("writes plan and entitlement_level in lock-step (same value)", () => {
    // Both columns must be set together to prevent the dual-column drift
    // we just healed in the migration.
    expect(SOURCE).toMatch(/entitlement_level\s*=\s*\$1,\s*\n\s*plan\s*=\s*\$1/);
  });
});

describe("stripeWebhook.ts: org resolution", () => {
  it("resolves by organizations.stripe_customer_id first (durable path)", () => {
    expect(SOURCE).toMatch(
      /SELECT id FROM organizations WHERE stripe_customer_id = \$1/
    );
  });

  it("falls back to api_keys.id → organization_id only when customer lookup misses", () => {
    expect(SOURCE).toMatch(
      /SELECT organization_id FROM api_keys WHERE id = \$1/
    );
    // The fallback must come after the primary, not before.
    const customerIdx = SOURCE.indexOf(
      "SELECT id FROM organizations WHERE stripe_customer_id"
    );
    const apiKeyIdx = SOURCE.indexOf(
      "SELECT organization_id FROM api_keys WHERE id"
    );
    expect(customerIdx).toBeGreaterThan(-1);
    expect(apiKeyIdx).toBeGreaterThan(-1);
    expect(customerIdx).toBeLessThan(apiKeyIdx);
  });

  it("logs which path resolved (stripe_customer_id vs api_key_id)", () => {
    expect(SOURCE).toMatch(/resolvedBy:\s*"stripe_customer_id"/);
    expect(SOURCE).toMatch(/resolvedBy:\s*"api_key_id"/);
  });
});

describe("stripeWebhook.ts: idempotency gate (C3)", () => {
  it("calls claimWebhookEvent before any downstream side-effect call", () => {
    // The gate must sit before downstream entitlement writes so a duplicate
    // event_id short-circuits without re-running side effects. UPDATE strings
    // inside helper-function bodies appear earlier in source than the main
    // handler, so the right anchors are the CALL sites of those helpers.
    const claimCallIdx = SOURCE.indexOf('claimWebhookEvent("stripe"');
    const redisCallIdx = SOURCE.indexOf("await setEntitlementInRedis(apiKeyId");
    const syncCallIdx = SOURCE.indexOf("await syncOrgEntitlement(");
    const paymentFailedCallIdx = SOURCE.indexOf("await handlePaymentFailed(");
    expect(claimCallIdx).toBeGreaterThan(-1);
    expect(redisCallIdx).toBeGreaterThan(-1);
    expect(syncCallIdx).toBeGreaterThan(-1);
    expect(paymentFailedCallIdx).toBeGreaterThan(-1);
    expect(claimCallIdx).toBeLessThan(redisCallIdx);
    expect(claimCallIdx).toBeLessThan(syncCallIdx);
    expect(claimCallIdx).toBeLessThan(paymentFailedCallIdx);
  });

  it("short-circuits the duplicate path with idempotent_replay:true (200)", () => {
    expect(SOURCE).toMatch(/idempotent_replay:\s*true/);
    expect(SOURCE).toMatch(/stripe_webhook_idempotent_replay/);
  });

  it("fails CLOSED on claim INSERT failure (500, not silent retry)", () => {
    // Fail-open here would silently re-process during a Postgres-unhealthy
    // window. Fail-closed lets Stripe's retry mechanism handle the gap.
    expect(SOURCE).toMatch(/stripe_webhook_idempotency_claim_failed/);
    expect(SOURCE).toMatch(
      /res\.status\(500\)\.json\(\{\s*error:\s*"idempotency_check_failed"\s*\}\)/
    );
  });
});

describe("stripeWebhook.ts: stale-revoke guard", () => {
  it("only fires on customer.subscription.deleted events", () => {
    // The guard's outer condition must be the .deleted event type, not
    // the broader entitlement.tier === "free" check that also matched
    // .updated → canceled events.
    expect(SOURCE).toMatch(
      /eventType === "customer\.subscription\.deleted" && subscriptionId/
    );
  });

  it("compares sub.id against organizations.stripe_subscription_id", () => {
    // The stronger guard (E.3 in the sketch) compares sub IDs, not tier
    // strings. Tier comparison was unreliable under same-tier renewals.
    expect(SOURCE).toMatch(
      /SELECT stripe_subscription_id FROM organizations WHERE id = \$1/
    );
    expect(SOURCE).toMatch(/currentSubId !== subscriptionId/);
  });
});

describe("stripeWebhook.ts: Platform free trial (PR-C2)", () => {
  it("status 'trialing' grants full entitlement identically to 'active'", () => {
    // Both statuses land on the same grant branch (activeSubscription: true).
    expect(SOURCE).toMatch(
      /status === "active" \|\| status === "trialing"[\s\S]{0,120}activeSubscription:\s*true/
    );
  });

  it("records trial_started_at only for a Platform tier at status 'trialing', guarded IS NULL", () => {
    expect(SOURCE).toMatch(/subscriptionStatus === "trialing"/);
    expect(SOURCE).toMatch(/rawSubscriptionTier === "platform"/);
    expect(SOURCE).toMatch(/rawSubscriptionTier === "platform_annual"/);
    // Idempotent, at-most-once write — guarded WHERE trial_started_at IS NULL.
    expect(SOURCE).toMatch(
      /UPDATE organizations SET trial_started_at = NOW\(\)[\s\S]{0,80}WHERE id = \$1 AND trial_started_at IS NULL/
    );
  });

  it("records the trial claim AFTER the entitlement sync (not before)", () => {
    const syncIdx = SOURCE.indexOf("await syncOrgEntitlement(");
    const claimIdx = SOURCE.indexOf("UPDATE organizations SET trial_started_at = NOW()");
    expect(syncIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(syncIdx);
  });

  it("handles customer.subscription.trial_will_end gracefully (logged, no throw, 200)", () => {
    expect(SOURCE).toMatch(/eventType === "customer\.subscription\.trial_will_end"/);
    expect(SOURCE).toMatch(/stripe_trial_will_end/);
    expect(SOURCE).toMatch(/trial_will_end:\s*true/);
  });
});
