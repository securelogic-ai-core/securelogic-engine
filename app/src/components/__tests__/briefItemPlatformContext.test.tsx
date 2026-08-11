/**
 * BriefItemPlatformContext (EG2 slice 6) — the visible proof a brief item is
 * connected to the tenant's own records. The engine computed and stored these
 * matches since 20260511 and never returned them; these tests pin the render
 * contract now that it does: every match links to its canonical record, and
 * non-personalized items render nothing.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  BriefItemContextStrip,
  BriefItemContextCallout,
  platformContextLinks,
} from "../BriefItemPlatformContext";
import type { IntelligenceBriefItem } from "@/lib/api";

function personalizedItem(
  overrides: Partial<IntelligenceBriefItem> = {}
): IntelligenceBriefItem {
  return {
    id: "item-1",
    category: "vulnerability",
    relevance: "high",
    title: "RCE in Acme Gateway",
    summary: "Exploited RCE.",
    affected_cve: "CVE-2026-1",
    affected_vendor: "Acme Cloud",
    source_slug: null,
    signal_type: null,
    severity: "critical",
    cyber_signal_id: null,
    ingestion_timestamp: null,
    sort_order: 0,
    why_it_matters: null,
    recommended_actions: null,
    analyst_notes: null,
    urgency: null,
    is_personalized: true,
    platform_context: {
      matched_vendors: [{ id: "v-1", name: "Acme Cloud" }],
      matched_ai_systems: [{ id: "s-1", name: "Support Copilot" }],
      matched_risks: [{ id: "r-1", title: "Unpatched edge devices" }],
      matched_obligations: [],
    },
    ...overrides,
  };
}

describe("platformContextLinks", () => {
  it("flattens matches in vendor-first order with canonical-record hrefs", () => {
    const links = platformContextLinks(personalizedItem().platform_context);
    expect(links.map((l) => l.href)).toEqual(["/vendors/v-1", "/ai-systems/s-1", "/risks/r-1"]);
  });

  it("is empty for null context", () => {
    expect(platformContextLinks(null)).toEqual([]);
  });
});

describe("BriefItemContextStrip", () => {
  it("names the first match, links it, and counts the rest", () => {
    render(<BriefItemContextStrip item={personalizedItem()} />);

    expect(screen.getByText(/Affects your vendor/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme Cloud →" })).toHaveAttribute(
      "href",
      "/vendors/v-1"
    );
    expect(screen.getByText("+2 more in your inventory")).toBeInTheDocument();
  });

  it("renders nothing for a non-personalized item", () => {
    const { container } = render(
      <BriefItemContextStrip
        item={personalizedItem({ is_personalized: false, platform_context: null })}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BriefItemContextCallout", () => {
  it("lists every match as a link to its record", () => {
    render(<BriefItemContextCallout item={personalizedItem()} />);

    expect(screen.getByRole("link", { name: "Acme Cloud →" })).toHaveAttribute("href", "/vendors/v-1");
    expect(screen.getByRole("link", { name: "Support Copilot →" })).toHaveAttribute(
      "href",
      "/ai-systems/s-1"
    );
    expect(screen.getByRole("link", { name: "Unpatched edge devices →" })).toHaveAttribute(
      "href",
      "/risks/r-1"
    );
  });

  it("renders nothing when personalization matched nothing", () => {
    const { container } = render(
      <BriefItemContextCallout
        item={personalizedItem({
          is_personalized: true,
          platform_context: { matched_vendors: [] },
        })}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
