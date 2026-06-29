import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Source-shape tests for canonical checkout plan routing.
 *
 * Guards the single canonical billing-plan namespace used end-to-end
 * (marketing CTA -> /signup?plan=<tier> -> checkout tier -> Stripe Price ID
 * -> webhook -> entitlement_level). The ONLY valid plan tokens are:
 *
 *   professional, teams, platform, platform_annual
 *
 * P0 regression context: the marketing site previously emitted non-canonical
 * tokens (brief-pro, brief-team, and `professional` meaning Platform), which
 * dropped paid CTAs to free signup or routed Platform buyers to the $49 Brief
 * Pro price. These tests assert the engine contract each canonical token must
 * resolve to, so a future remap or reintroduced alias fails CI.
 *
 * resolvePriceId() and tierToDbLevel() are not exported and the codebase has
 * no live-server harness, so we assert the source shape (same idiom as
 * stripeWebhookSync.test.ts). No billing/entitlement/webhook logic is changed.
 */

const BILLING = readFileSync(resolve(__dirname, "../routes/billing.ts"), "utf8");
const WEBHOOK = readFileSync(resolve(__dirname, "../webhooks/stripeWebhook.ts"), "utf8");

// Canonical token -> { Stripe Price ID env var, entitlement_level }
const ROUTING = [
  { tier: "professional",    priceEnv: "STRIPE_PRICE_ID_PROFESSIONAL",    entitlement: "professional" },
  { tier: "teams",           priceEnv: "STRIPE_PRICE_ID_TEAMS",           entitlement: "professional" },
  { tier: "platform",        priceEnv: "STRIPE_PRICE_ID_PLATFORM",        entitlement: "premium" },
  { tier: "platform_annual", priceEnv: "STRIPE_PRICE_ID_PLATFORM_ANNUAL", entitlement: "premium" },
] as const;

describe("checkout plan routing: VALID_TIERS is exactly the canonical set", () => {
  it("accepts only the four canonical tokens", () => {
    expect(BILLING).toMatch(
      /const VALID_TIERS = new Set\(\["professional", "teams", "platform", "platform_annual"\]\)/
    );
  });

  it("does not accept legacy/marketing aliases (brief-pro, brief-team, bare team)", () => {
    expect(BILLING).not.toMatch(/"brief-pro"/);
    expect(BILLING).not.toMatch(/"brief-team"/);
    // bare "team" (without the trailing s) was an app /pricing alias bug
    expect(BILLING).not.toMatch(/VALID_TIERS[\s\S]*?"team"\s*[,\]]/);
  });
});

describe("checkout plan routing: tier -> Stripe Price ID (resolvePriceId)", () => {
  for (const { tier, priceEnv } of ROUTING) {
    it(`${tier} -> ${priceEnv}`, () => {
      // e.g.  professional:    process.env.STRIPE_PRICE_ID_PROFESSIONAL?.trim(),
      // The trailing ?  after the env name keeps platform from matching the
      // platform_annual line (STRIPE_PRICE_ID_PLATFORM? vs ..._PLATFORM_ANNUAL?).
      const re = new RegExp(`\\b${tier}:\\s*process\\.env\\.${priceEnv}\\?`);
      expect(BILLING).toMatch(re);
    });
  }
});

describe("checkout plan routing: tier -> entitlement_level (tierToDbLevel)", () => {
  it("professional and teams -> professional", () => {
    expect(WEBHOOK).toMatch(
      /if \(tier === "professional" \|\| tier === "teams"\) \{\s*\n\s*return "professional";/
    );
  });

  it("platform and platform_annual -> premium", () => {
    expect(WEBHOOK).toMatch(/tier === "platform"/);
    expect(WEBHOOK).toMatch(/tier === "platform_annual"/);
    expect(WEBHOOK).toMatch(/return "premium";/);
  });

  it("entitlement expectations table matches the platform/brief split", () => {
    // professional-class (Brief Pro + Team Professional) -> professional
    // premium-class (Platform Professional + Platform Annual) -> premium
    const professionalClass = ROUTING.filter((r) => r.entitlement === "professional").map((r) => r.tier);
    const premiumClass = ROUTING.filter((r) => r.entitlement === "premium").map((r) => r.tier);
    expect(professionalClass).toEqual(["professional", "teams"]);
    expect(premiumClass).toEqual(["platform", "platform_annual"]);
  });
});
