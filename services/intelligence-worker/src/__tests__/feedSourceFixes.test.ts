/**
 * feedSourceFixes.test.ts — source-structural guards for the 2026-06 feed fixes:
 *   - The Register: re-pointed to the resolved api.theregister.com RSS
 *   - ICO: re-pointed to the new /global/rss-feeds/enforcement/ + browser UA
 *   - Dark Reading: retired
 *   - ENISA / NYDFS: deliberately UNCHANGED (backlog) — scope guard
 *
 * Structural (readFileSync) per the repo convention for feed-source files,
 * which have no live-network unit harness.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) =>
  readFileSync(resolve(__dirname, "..", "sources", rel), "utf8");

describe("securityNewsFeed.ts — The Register re-point", () => {
  const src = read("securityNewsFeed.ts");
  it("points at the resolved api.theregister.com RSS endpoint", () => {
    expect(src).toMatch(
      /url:\s*"https:\/\/api\.theregister\.com\/api\/v1\/article\?orderBy=published&site_id=2&remapper=rss&query=tag:security"/
    );
  });
  it("no longer uses the redirecting headlines.atom URL", () => {
    expect(src).not.toMatch(/theregister\.com\/security\/headlines\.atom/);
  });
  it("keeps the security_news_theregister source key", () => {
    expect(src).toMatch(/source:\s*"security_news_theregister"/);
  });
});

describe("vendorRiskFeed.ts — Dark Reading retired", () => {
  const src = read("vendorRiskFeed.ts");
  it("removed the vendor_risk_darkreading feed entry", () => {
    expect(src).not.toMatch(/source:\s*"vendor_risk_darkreading"/);
    expect(src).not.toMatch(/darkreading\.com/);
  });
  it("keeps SecurityWeek", () => {
    expect(src).toMatch(/source:\s*"vendor_risk_securityweek"/);
  });
});

describe("regulatoryEnforcementFeed.ts — ICO re-point + browser UA", () => {
  const src = read("regulatoryEnforcementFeed.ts");
  it("points ICO at the new /global/rss-feeds/enforcement/ feed", () => {
    expect(src).toMatch(/url:\s*"https:\/\/ico\.org\.uk\/global\/rss-feeds\/enforcement\/"/);
  });
  it("no longer uses the retired media-centre ICO path", () => {
    expect(src).not.toMatch(/ico\.org\.uk\/about-the-ico\/media-centre\/rss/);
  });
  it("uses a browser-like User-Agent on the parser", () => {
    expect(src).toMatch(/User-Agent[\s\S]*?Mozilla\/5\.0[\s\S]*?Chrome\/[\d.]+ Safari/);
  });
  it("leaves ENISA and NYDFS untouched (backlog — scope guard)", () => {
    expect(src).toMatch(/url:\s*"https:\/\/www\.enisa\.europa\.eu\/publications\/rss"/);
    expect(src).toMatch(/url:\s*"https:\/\/www\.dfs\.ny\.gov\/industry_guidance\/circular_letters\/rss\.xml"/);
  });
});
