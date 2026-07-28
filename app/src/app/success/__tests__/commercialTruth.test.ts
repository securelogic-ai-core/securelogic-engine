/**
 * Commercial-truth contracts for the post-checkout surface (#692).
 *
 * Regression pins for three defects from the 2026-07-28 commercial-flow review:
 *
 *  1. /success carried its own plan-label map whose `premium → "Team"` told a
 *     Platform Annual buyer "Team is now active". The page must use the ONE
 *     canonical map (`planDisplayName` in @/lib/api) and must not re-declare
 *     a local vocabulary — the exact drift class the canonical map exists for.
 *  2. /api/session/refresh returned only entitlementLevel, so no caller could
 *     distinguish Platform Annual / Brief Team at the moment of purchase. It
 *     must expose stripeSubscriptionTier.
 *  3. /api/auth-verify-email built a session WITHOUT userRole (unlike its
 *     sibling auth-login), so the brand-new org admin lost admin nav until
 *     re-login.
 *
 * Source-contract style (mirrors the engine's checkoutPlanRouting.test.ts):
 * these pins assert the wiring that a render harness cannot cheaply reach
 * (polling page, iron-session route handlers).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) =>
  readFileSync(join(__dirname, "../../../..", rel), "utf8");

describe("/success plan label — canonical map only", () => {
  const src = read("src/app/success/page.tsx");

  it("imports planDisplayName from the canonical module", () => {
    expect(src).toMatch(/import \{ planDisplayName \} from "@\/lib\/api"/);
  });

  it("declares no local plan-label map", () => {
    expect(src).not.toMatch(/function planDisplayName/);
    expect(src).not.toMatch(/case "premium":\s*return "Team"/);
  });

  it("passes the Stripe tier through to the canonical map", () => {
    expect(src).toMatch(/stripeSubscriptionTier/);
    expect(src).toMatch(/planDisplayName\(level \?\? "starter", tier\)/);
  });
});

describe("/api/session/refresh — exposes the precise tier", () => {
  const src = read("src/app/api/session/refresh/route.ts");

  it("returns stripeSubscriptionTier alongside entitlementLevel", () => {
    expect(src).toMatch(/stripeSubscriptionTier: me\.stripeSubscriptionTier \?\? null/);
  });
});

describe("/api/auth-verify-email — session parity with auth-login", () => {
  const verifySrc = read("src/app/api/auth-verify-email/route.ts");
  const loginSrc = read("src/app/api/auth-login/route.ts");

  it("sets session.userRole like the login route does", () => {
    expect(loginSrc).toMatch(/session\.userRole/);
    expect(verifySrc).toMatch(/session\.userRole\s*=\s*me\.role \?\? "viewer"/);
  });
});
