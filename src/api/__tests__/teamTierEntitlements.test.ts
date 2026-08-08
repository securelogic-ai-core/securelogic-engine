import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { requireTeamCapability } from "../middleware/requireTeamCapability.js";

/**
 * Brief Team entitlement fixes (#692 A2 + A8).
 *
 * A2 — the P0: Brief Team orgs land at entitlement_level='professional'
 * (rank 2) while all five team-invite routes demanded rank-4 'premium' —
 * every paying Brief Team customer 403'd on the tier's headline feature.
 * Mechanism pinned here: an explicit 'teams'-tier allowance on the team
 * routes ONLY. The global rank lattice is untouched — Brief Pro still can't
 * reach team routes and none of the other premium gates change meaning.
 *
 * A8 — sold-10/capped-6: both pricing surfaces sell Platform as "Up to 10
 * seats"; the webhook now raises max_members to >= 10 on platform-tier
 * grants (GREATEST — mirror of the entity-cap raise). Brief tiers stay 6.
 */

function run(ctx: unknown) {
  const req = { organizationContext: ctx } as any;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json } as any;
  const next = vi.fn();
  requireTeamCapability()(req, res, next);
  return { status, json, next };
}

describe("requireTeamCapability — mechanism", () => {
  it("passes a Brief Team org (entitlement 'professional', tier 'teams')", () => {
    const { next, status } = run({ entitlementLevel: "professional", stripeSubscriptionTier: "teams" });
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("still passes every platform rank, tier irrelevant", () => {
    for (const level of ["premium", "platform", "team"]) {
      const { next } = run({ entitlementLevel: level, stripeSubscriptionTier: null });
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("still 403s solo Brief Pro (entitlement 'professional', tier 'professional')", () => {
    const { next, status, json } = run({ entitlementLevel: "professional", stripeSubscriptionTier: "professional" });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "insufficient_entitlement" }));
  });

  it("403s starter, 401s missing context (requireEntitlement contract parity)", () => {
    const starter = run({ entitlementLevel: "starter", stripeSubscriptionTier: null });
    expect(starter.status).toHaveBeenCalledWith(403);
    const noCtx = run(undefined);
    expect(noCtx.status).toHaveBeenCalledWith(401);
  });
});

describe("wiring — the five team routes and the org context", () => {
  const INVITES = readFileSync(resolve(__dirname, "../routes/teamInvites.ts"), "utf8");
  const CTX = readFileSync(resolve(__dirname, "../middleware/attachOrganizationContext.ts"), "utf8");

  it("all five team routes use requireTeamCapability; none still demand raw premium", () => {
    expect((INVITES.match(/requireTeamCapability\(\)/g) ?? []).length).toBe(5);
    expect(INVITES).not.toMatch(/requireEntitlement\("premium"\)/);
  });

  it("attachOrganizationContext exposes the precise Stripe tier", () => {
    expect(CTX).toMatch(/stripe_subscription_tier/);
    expect(CTX).toMatch(/stripeSubscriptionTier: row\?\.stripe_subscription_tier \?\? null/);
  });

  it("the global rank lattice is untouched (no 'teams' in requireEntitlement)", () => {
    const RANKS = readFileSync(resolve(__dirname, "../middleware/requireEntitlement.js").replace(".js", ".ts"), "utf8");
    expect(RANKS).not.toMatch(/teams/);
  });
});

describe("A8 — webhook honors the advertised 10 platform seats", () => {
  const WEBHOOK = readFileSync(resolve(__dirname, "../webhooks/stripeWebhook.ts"), "utf8");

  it("platform-tier grants raise max_members to >= 10, never lower", () => {
    expect(WEBHOOK).toMatch(
      /max_members\s+= CASE\s*\n\s*WHEN \$1 = 'premium' THEN GREATEST\(COALESCE\(max_members, 6\), 10\)/
    );
  });

  it("brief tiers ('professional', incl. Brief Team) get no seat raise", () => {
    const caseIdx = WEBHOOK.indexOf("max_members                = CASE");
    const slice = WEBHOOK.slice(caseIdx, caseIdx + 400);
    expect(slice).not.toMatch(/'professional'/);
    expect(slice).toMatch(/ELSE max_members/);
  });
});
