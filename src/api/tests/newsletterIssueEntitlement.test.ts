import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { allowedAudienceTiers, shapeIssue } from "../routes/newsletterIssues.js";

// ====================================================================
// Newsletter-issue entitlement gating (staging walkthrough defect,
// 2026-07): a Platform Professional tenant (entitlement_level
// 'platform' — seeded orgs carry the raw value, not the webhook's
// 'premium') was mapped to the free tier and served locked issues
// with consumer "Upgrade to Brief Pro" prompts. The audience-tier
// mapping must rank platform-family entitlements exactly like
// requireEntitlement does.
// ====================================================================

describe("allowedAudienceTiers — platform-family entitlements unlock everything", () => {
  it.each(["premium", "platform", "platform_annual", "team", "PLATFORM", "Team"])(
    "'%s' reads free + standard + premium",
    (level) => {
      expect(allowedAudienceTiers(level)).toEqual(["free", "standard", "premium"]);
    }
  );

  it.each(["professional", "standard"])("'%s' reads free + standard", (level) => {
    expect(allowedAudienceTiers(level)).toEqual(["free", "standard"]);
  });

  it.each(["starter", "free", "", "garbage", null])(
    "'%s' reads free only",
    (level) => {
      expect(allowedAudienceTiers(level as string | null)).toEqual(["free"]);
    }
  );
});

describe("shapeIssue — lock state follows the corrected mapping", () => {
  const premiumIssue = {
    id: "11111111-1111-1111-1111-111111111111",
    organization_id: null,
    issue_number: 42,
    title: "Weekly brief",
    summary: "Summary",
    thesis_headline: "Headline",
    status: "sent",
    audience_tier: "premium",
    publish_date: "2026-05-19",
    created_at: "2026-05-19T07:00:00Z",
    updated_at: "2026-05-19T07:00:00Z",
    content_html: "<p>full content</p>",
    content_md: "full content",
    sections_json: { securityIncidents: [] },
    cross_domain_analysis: "analysis",
    action_summary_json: { thisWeek: [] },
    publication_context_json: null
  };

  it.each(["platform", "team", "premium", "platform_annual"])(
    "a '%s' org receives a premium-tier issue UNLOCKED with full content",
    (level) => {
      const shaped = shapeIssue(premiumIssue, level);
      expect(shaped.locked).toBe(false);
      expect(shaped.content_html).toBe("<p>full content</p>");
      expect(shaped.sections_json).toEqual({ securityIncidents: [] });
    }
  );

  it("a starter org still receives a premium-tier issue locked with content nulled", () => {
    const shaped = shapeIssue(premiumIssue, "starter");
    expect(shaped.locked).toBe(true);
    expect(shaped.content_html).toBeNull();
    expect(shaped.content_md).toBeNull();
    expect(shaped.sections_json).toBeNull();
    expect(shaped.cross_domain_analysis).toBeNull();
    expect(shaped.action_summary_json).toBeNull();
    // Teaser metadata remains so the client can render a preview.
    expect(shaped.title).toBe("Weekly brief");
    expect(shaped.publish_date).toBe("2026-05-19");
  });

  it("a professional (Brief Pro) org reads standard-tier issues but not premium-tier", () => {
    const standardIssue = { ...premiumIssue, audience_tier: "standard" };
    expect(shapeIssue(standardIssue, "professional").locked).toBe(false);
    expect(shapeIssue(premiumIssue, "professional").locked).toBe(true);
  });
});
