import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Billing-lifecycle visibility contracts (#692 A6/A7).
 *
 * Source-shape tests in the stripeWebhookSync.test.ts idiom (the handlers are
 * not exported and there is no live-server harness).
 *
 * A6 — the /account "Payment failed" banner keys off
 *   `me.billingActive === false && me.entitlementLevel !== "starter"`.
 *   GET /api/me previously defined billingActive as "is a paid tier", which
 *   makes that condition unsatisfiable (starter ∧ ¬starter) — the banner was
 *   dead code for the entire Stripe retry/grace window. The contract pinned
 *   here: /api/me and /api/auth/me share ONE billingActive semantics —
 *   non-starter AND no payment_failed_at stamp.
 *
 * A7 — customer.subscription.trial_will_end must do more than log: it emails
 *   the org's verified admins so the conversion charge never lands
 *   unannounced, and the email path must be non-fatal (Stripe retries the
 *   whole event on a non-2xx, which would double-send on unrelated failures).
 */

const ACCOUNT = readFileSync(resolve(__dirname, "../routes/account.ts"), "utf8");
const CUSTOMER_AUTH = readFileSync(resolve(__dirname, "../routes/customerAuth.ts"), "utf8");
const WEBHOOK = readFileSync(resolve(__dirname, "../webhooks/stripeWebhook.ts"), "utf8");

describe("A6 — GET /api/me billingActive is payment-failure-aware", () => {
  it("selects payment_failed_at from organizations", () => {
    expect(ACCOUNT).toMatch(/o\.payment_failed_at\s+AS payment_failed_at/);
  });

  it("billingActive = non-starter AND no payment failure (matches /api/auth/me)", () => {
    expect(ACCOUNT).toMatch(
      /billingActive = entitlementLevel !== "starter" && !row\.payment_failed_at/
    );
    // The reference semantics this converges on (customerAuth.ts):
    expect(CUSTOMER_AUTH).toMatch(
      /billingActive:\s*org\?\.entitlement_level !== "starter" && !org\?\.payment_failed_at/
    );
  });

  it("no longer defines billingActive as merely being on a paid tier", () => {
    expect(ACCOUNT).not.toMatch(
      /billingActive = entitlementLevel === "premium" \|\| entitlementLevel === "professional"/
    );
  });
});

describe("A7 — trial_will_end emails org admins", () => {
  it("the trial_will_end handler invokes the email helper", () => {
    const handlerIdx = WEBHOOK.indexOf('eventType === "customer.subscription.trial_will_end"');
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerSlice = WEBHOOK.slice(handlerIdx, handlerIdx + 1200);
    expect(handlerSlice).toMatch(/sendTrialWillEndEmails\(sub, trialCustomerId\)/);
  });

  it("email failure is non-fatal — handler still responds 200", () => {
    const handlerIdx = WEBHOOK.indexOf('eventType === "customer.subscription.trial_will_end"');
    const handlerSlice = WEBHOOK.slice(handlerIdx, handlerIdx + 1600);
    expect(handlerSlice).toMatch(/catch \(err\)/);
    expect(handlerSlice).toMatch(/stripe_trial_will_end_email_failed/);
    expect(handlerSlice).toMatch(/respond\(\{ received: true, trial_will_end: true \}\)/);
  });

  it("resolves the org by stripe_customer_id and emails verified admins only", () => {
    expect(WEBHOOK).toMatch(
      /SELECT id, name FROM organizations WHERE stripe_customer_id = \$1 LIMIT 1/
    );
    expect(WEBHOOK).toMatch(
      /role = 'admin' AND email_verified = TRUE/
    );
  });

  it("uses the shared transactional email infra, not an ad-hoc sender", () => {
    expect(WEBHOOK).toMatch(/import \{ sendEmail \} from "\.\.\/infra\/email\.js"/);
  });

  it("never changes entitlement from this event", () => {
    const handlerIdx = WEBHOOK.indexOf('eventType === "customer.subscription.trial_will_end"');
    const handlerSlice = WEBHOOK.slice(handlerIdx, handlerIdx + 1600);
    expect(handlerSlice).not.toMatch(/UPDATE organizations[\s\S]*entitlement_level/);
    expect(handlerSlice).not.toMatch(/setEntitlementInRedis/);
  });
});
