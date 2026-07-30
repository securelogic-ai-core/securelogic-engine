/**
 * /briefs and /briefs/[id] — the customer-facing Intelligence Brief render contract.
 *
 * TWO THINGS THIS FILE HOLDS:
 *
 * 1. R1 (fix(brief): remove internal feed names from the customer-facing Brief).
 *    The Brief used to tell an executive which PIPE an item came down — "CISA KEV",
 *    "NVD", "BleepingComputer", and in the payload the raw slug "cisa_kev". R1 removed
 *    the feed NAME from the render and kept the LINK to the primary source. The wire
 *    types still carry `BriefSignal.source` and `IntelligenceBriefItem.source_slug` /
 *    `source_display` (and the columns are retained for audit), so nothing but a render
 *    test can stop them coming back. The fixtures deliberately populate all three.
 *
 * 2. The drill-through. A brief item links to its own detail; a legacy signal links to
 *    the primary advisory ONLY when it has a URL. A link that goes nowhere — or to the
 *    wrong item — is worse than no link, because the reader cannot tell.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  sp,
  hrefs,
  hrefOf,
} from "@/test/harness";
import {
  aBriefSignal,
  aMe,
  aNewsletterIssue,
  anIntelligenceBrief,
  anIntelligenceBriefItem,
  anIssuesResponse,
} from "@/test/fixtures";

// ScrollSpyTOC (inside the legacy reader) drives the reading position with a real
// browser API jsdom does not implement. Stubbing it is the same class of boundary as
// next/link: the observer is the browser's job, the LINKS and LABELS it wraps are the
// contract under test, and they render for real.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
);

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getIssues: vi.fn(),
  getIssue: vi.fn(),
  getIntelligenceBrief: vi.fn(),
  getIntelligenceBriefs: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import BriefsPage from "../page";
import BriefDetailPage from "../[id]/page";

/** Every internal feed identifier R1 removed from the customer's view. */
const FEED_NAMES = ["cisa_kev", "CISA KEV", "cisa-kev", "NVD", "BleepingComputer", "source_slug"];

function expectNoFeedNames(text: string) {
  for (const name of FEED_NAMES) {
    expect(text).not.toContain(name);
  }
  // The bare meta line R1 deleted outright ("Source: cisa_kev"). The word "Source"
  // survives as the LINK label — "Source:" followed by a feed does not.
  expect(text).not.toMatch(/Source:\s*\S/);
  expect(text).not.toMatch(/\bVia\s+\S/);
  expect(text).not.toContain("Feed");
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));
  api.getIssues.mockResolvedValue(anIssuesResponse([aNewsletterIssue()]));
  api.getIssue.mockResolvedValue(null);
  api.getIntelligenceBrief.mockResolvedValue(null);
  // Default: no canonical briefs → the archive falls back to legacy issues.
  api.getIntelligenceBriefs.mockResolvedValue(null);
});

// ───────────────────────────── /briefs (the archive) ─────────────────────────

describe("/briefs — the archive", () => {
  it("names no internal feed anywhere on the page (R1 regression guard)", async () => {
    const { container } = await renderPage(BriefsPage, {});
    expectNoFeedNames(container.textContent ?? "");
    // ...while still being a real page: the issue is there to read.
    expect(screen.getByText("This week: an exploited gateway and a new AI rule")).toBeInTheDocument();
  });

  it("an unlocked issue is reachable; a locked one is NOT a link into a wall", async () => {
    api.getIssues.mockResolvedValue(
      anIssuesResponse([
        aNewsletterIssue({ id: "open-1", title: "Readable issue", locked: false }),
        aNewsletterIssue({ id: "locked-1", title: "Subscriber issue", locked: true }),
      ])
    );

    const { container } = await renderPage(BriefsPage, {});
    const all = hrefs(container);

    expect(all).toContain("/briefs/open-1");
    // A locked card links to /account (upgrade), never to a brief the reader cannot
    // open. Sending them to a lock screen they could have been spared is a dead end.
    expect(all).not.toContain("/briefs/locked-1");
    expect(all).toContain("/account");
    expect(all).not.toContain("#");
  });

  it("an unentitled reader is told what is locked and how to unlock it", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "free" }));
    api.getIssues.mockResolvedValue(
      anIssuesResponse([
        aNewsletterIssue({ id: "open-1", locked: false }),
        aNewsletterIssue({ id: "locked-1", locked: true }),
      ])
    );

    const { container } = await renderPage(BriefsPage, {});

    expect(container.textContent).toContain("1 brief locked");
    // The display tiers, and the internal keys the checkout actually posts.
    expect(screen.getByRole("button", { name: "Brief Pro — $49/mo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Brief Team — $199/mo" })).toBeInTheDocument();
    const tiers = Array.from(container.querySelectorAll('input[name="tier"]')).map((i) =>
      i.getAttribute("value")
    );
    expect(tiers).toEqual(["professional", "teams"]);
  });

  it("an entitled reader is not upsold", async () => {
    // isPremium = entitlementLevel ∈ {premium, professional} (the page's real rule).
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));
    api.getIssues.mockResolvedValue(
      anIssuesResponse([aNewsletterIssue({ id: "locked-1", locked: true })])
    );

    const { container } = await renderPage(BriefsPage, {});

    expect(container.textContent).not.toContain("Upgrade for full access");
    expect(screen.queryByRole("button", { name: "Brief Pro — $49/mo" })).toBeNull();
  });

  it("says so plainly when nothing has been published", async () => {
    api.getIssues.mockResolvedValue(anIssuesResponse([]));

    const { container } = await renderPage(BriefsPage, {});

    expect(screen.getByText(/No briefs have been published yet/)).toBeInTheDocument();
    // No phantom counts, no upsell hung on an empty archive.
    expect(container.textContent).not.toContain("issues available");
    expect(container.textContent).not.toContain("locked");
  });

  it("sends a signed-out visitor to /login without asking the engine for briefs", async () => {
    signedOut();
    expect(await expectRedirect(BriefsPage, {})).toBe("/login");
    expect(api.getIssues).not.toHaveBeenCalled();
  });
});

// ─────────────────── /briefs/[id] — the canonical Intelligence Brief ──────────

const params = (id: string) => Promise.resolve({ id });

describe("/briefs/[id] — the Intelligence Brief", () => {
  const IMMEDIATE = anIntelligenceBriefItem({
    id: "item-imm",
    title: "Actively exploited RCE in Acme Cloud Gateway",
    urgency: "immediate",
  });
  const WATCHING = anIntelligenceBriefItem({
    id: "item-far",
    title: "Draft AI transparency rule enters consultation",
    category: "regulatory",
    relevance: "low",
    affected_cve: null,
    urgency: "far_term",
  });

  it("carries no internal feed name into the reader's brief (R1 regression guard)", async () => {
    // items[] carry source_slug "cisa_kev" and source_display "CISA KEV" on the wire.
    api.getIntelligenceBrief.mockResolvedValue(anIntelligenceBrief([IMMEDIATE, WATCHING]));

    const { container } = await renderPage(BriefDetailPage, { params: params("brief-1") });
    const text = container.textContent ?? "";

    expectNoFeedNames(text);
    // The things the reader CAN act on and verify are all still there.
    expect(text).toContain("Actively exploited RCE in Acme Cloud Gateway");
    expect(text).toContain("CVE-2026-1234");
    expect(text).toContain("Patch the gateway.");
  });

  it("every item drill-through resolves to THAT item, across the urgency grouping", async () => {
    // The grouping reorders the cards (immediate first) but the detail route resolves
    // by brief.items[] INDEX. If the render passed the post-grouping position, the
    // "far term" card would deep-link into the immediate item — a link that works and
    // is wrong, which is the worst kind.
    api.getIntelligenceBrief.mockResolvedValue(anIntelligenceBrief([WATCHING, IMMEDIATE]));

    const { container } = await renderPage(BriefDetailPage, { params: params("brief-1") });

    expect(hrefOf(container, "Draft AI transparency rule enters consultation")).toBe(
      "/briefs/brief-1/signal/item/0"
    );
    expect(hrefOf(container, "Actively exploited RCE in Acme Cloud Gateway")).toBe(
      "/briefs/brief-1/signal/item/1"
    );

    // No link may point past the end of items[] — that is a 404 dressed as a link.
    const indices = hrefs(container)
      .map((h) => h.match(/^\/briefs\/brief-1\/signal\/item\/(\d+)$/)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number);
    expect(indices.length).toBeGreaterThan(0);
    for (const i of indices) expect(i).toBeLessThan(2);
    expect(hrefs(container)).not.toContain("#");
  });

  it("an empty brief says it is empty rather than rendering an empty shell", async () => {
    api.getIntelligenceBrief.mockResolvedValue(anIntelligenceBrief([]));

    const { container } = await renderPage(BriefDetailPage, { params: params("brief-1") });

    expect(screen.getByText("No signals in this brief.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("IMMEDIATE");
    // Still a way back out — an empty page must not be a trap.
    expect(hrefs(container)).toContain("/dashboard");
  });

  it("an id that is neither a brief nor a legacy issue is a 404, not a blank page", async () => {
    api.getIntelligenceBrief.mockResolvedValue(null);
    api.getIssue.mockResolvedValue(null);

    expect(await expectRedirect(BriefDetailPage, { params: params("nope") })).toBe("__not_found__");
  });

  it("sends a signed-out visitor to /login without fetching the brief", async () => {
    signedOut();
    expect(await expectRedirect(BriefDetailPage, { params: params("brief-1") })).toBe("/login");
    expect(api.getIntelligenceBrief).not.toHaveBeenCalled();
  });
});

// ───────────────── /briefs/[id] — the legacy newsletter reader ────────────────

describe("/briefs/[id] — the legacy issue reader", () => {
  it("links to the primary source when there is one, and names no feed", async () => {
    api.getIssue.mockResolvedValue(
      aNewsletterIssue({
        sections_json: {
          securityIncidents: [
            aBriefSignal({
              title: "Exploited gateway",
              source: "cisa_kev",
              sourceUrl: "https://www.cisa.gov/advisory",
            }),
          ],
        },
      })
    );

    const { container } = await renderPage(BriefDetailPage, { params: params("issue-1") });

    // R1's ruling exactly: the LINK stays, the feed NAME goes.
    expect(hrefOf(container, "Source")).toBe("https://www.cisa.gov/advisory");
    expectNoFeedNames(container.textContent ?? "");
  });

  it("a signal with NO source URL renders no source link at all — never a dead one", async () => {
    api.getIssue.mockResolvedValue(
      aNewsletterIssue({
        sections_json: {
          securityIncidents: [
            aBriefSignal({
              title: "Exploited gateway",
              source: "cisa_kev", // the feed name exists...
              sourceUrl: undefined, // ...but there is nothing to click.
              source_url: undefined,
            }),
          ],
        },
      })
    );

    const { container } = await renderPage(BriefDetailPage, { params: params("issue-1") });
    const all = hrefs(container);

    // "With nothing to click, naming the pipe tells the reader nothing" — R1. So the
    // line is REMOVED, not replaced with an unclickable feed name or a href="#".
    expect(all).not.toContain("#");
    expect(all.some((h) => h.startsWith("http"))).toBe(false);
    expectNoFeedNames(container.textContent ?? "");

    // The item itself is still readable and still drills through.
    expect(hrefOf(container, "Exploited gateway")).toBe("/briefs/issue-1/signal/priority/0");
  });

  it("a locked issue shows the honest gate — the teaser, not the analysis", async () => {
    api.getIssue.mockResolvedValue(
      aNewsletterIssue({
        locked: true,
        thesis_headline: "Patch the gateway before the regulator asks about it.",
        sections_json: {
          securityIncidents: [
            aBriefSignal({
              title: "Exploited gateway",
              recommendedAction: "Patch the Acme Cloud Gateway this week.",
              riskRationale: "The gateway is internet-facing.",
            }),
          ],
        },
      })
    );

    const { container } = await renderPage(BriefDetailPage, { params: params("issue-1") });
    const text = container.textContent ?? "";

    expect(text).toContain("Full access is limited to subscribers.");
    expect(hrefOf(container, "Upgrade to unlock")).toBe("/account");
    // The gate must actually gate: the paid analysis and actions do not render.
    expect(text).not.toContain("Patch the Acme Cloud Gateway this week.");
    expect(text).not.toContain("The gateway is internet-facing.");
    // But the reader is told what they would get — 1 signal, 1 critical, Security.
    expect(text).toContain("1 signal");
    expect(text).toContain("Security Incidents");
    expectNoFeedNames(text);
  });

  it("an issue with no content says so instead of rendering an empty reader", async () => {
    api.getIssue.mockResolvedValue(
      aNewsletterIssue({
        sections_json: null,
        cross_domain_analysis: null,
        action_summary_json: null,
      })
    );

    const { container } = await renderPage(BriefDetailPage, { params: params("issue-1") });

    expect(screen.getByText("This brief has no content yet.")).toBeInTheDocument();
    expect(hrefs(container)).toContain("/briefs");
  });
});

// ───────────────────────────── flag branches ─────────────────────────────────

describe("/briefs — feature flags (no mixed state)", () => {
  // Neither Brief page reads a feature flag: the Brief is the WEDGE — it ships to
  // customers on the default path, not behind a dark flag. This test pins that. If a
  // flag is ever added, it fails here and forces both branches to be covered.
  it("renders identically under both risk-workspace flag branches", async () => {
    api.getIntelligenceBrief.mockResolvedValue(
      anIntelligenceBrief([anIntelligenceBriefItem()])
    );

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    const on = await renderPage(BriefDetailPage, { params: params("brief-1") });
    const onText = on.container.textContent;
    const onLinks = hrefs(on.container);
    on.unmount();

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    const off = await renderPage(BriefDetailPage, { params: params("brief-1") });

    expect(off.container.textContent).toBe(onText);
    expect(hrefs(off.container)).toEqual(onLinks);
  });

  it("the archive is flag-independent too", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    const on = await renderPage(BriefsPage, {});
    const onText = on.container.textContent;
    on.unmount();

    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "false");
    const off = await renderPage(BriefsPage, {});

    expect(off.container.textContent).toBe(onText);
  });
});

// ─────────────── /briefs — canonical intelligence-brief archive (EG2 slice 4) ───────────────

describe("/briefs — the canonical archive lists intelligence briefs, not the retired newsletter", () => {
  const listBrief = (id: string, period_end: string) => ({
    id,
    period_start: "2026-07-20",
    period_end,
    status: "published" as const,
    signal_count: 41,
    item_count: 7,
    generated_at: period_end,
    published_at: period_end,
    created_at: period_end,
  });

  it("published intelligence briefs render as the featured card + previous grid, each linking to its detail page", async () => {
    api.getIntelligenceBriefs.mockResolvedValue({
      briefs: [listBrief("ib-2", "2026-07-27"), listBrief("ib-1", "2026-07-20")],
      next_cursor: null,
    });

    const { container } = await renderPage(BriefsPage, {});

    expect(screen.getByText("Latest Brief")).toBeInTheDocument();
    expect(screen.getByText("Previous Briefs")).toBeInTheDocument();
    expect(container.querySelector('a[href="/briefs/ib-2"]')).not.toBeNull();
    expect(container.querySelector('a[href="/briefs/ib-1"]')).not.toBeNull();
    // The list endpoint was asked for published briefs only.
    expect(api.getIntelligenceBriefs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "published" })
    );
    // Legacy issues demote to a clearly-labeled legacy section.
    expect(screen.getByText("Legacy Issues")).toBeInTheDocument();
  });

  it("with no canonical briefs the legacy archive renders exactly as before", async () => {
    const { container } = await renderPage(BriefsPage, {});

    expect(screen.queryByText("Latest Brief")).toBeNull();
    expect(screen.queryByText("Legacy Issues")).toBeNull();
    // The legacy issue from the beforeEach fixture is still reachable.
    expect(container.textContent).toContain("Latest Issue");
  });
});
