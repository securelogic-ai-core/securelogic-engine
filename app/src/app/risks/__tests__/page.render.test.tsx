/**
 * /risks — render contract.
 *
 * The destination of the dashboard's "Open Risks" tile. Before #638 the tile counted
 * risks still on the register while this page applied NO status filter at all, so the
 * tile's number was not reproducible by any URL: the page also listed the closed and
 * transferred risks the tile had excluded.
 *
 * Risk fixtures are local to this file rather than shared: `Risk` is only needed here,
 * and typing it against the real exported type still fails the build if the wire
 * contract drifts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, signedOut, sp, hrefOf } from "@/test/harness";
import { aMe } from "@/test/fixtures";
import type { Risk, RisksResponse, RisksSummary } from "@/lib/api";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getRisks: vi.fn(),
  getRisksIntelligence: vi.fn(),
  getRisksSummary: vi.fn(),
  getRiskScale: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import RisksPage from "../page";

function aRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "r-1",
    organization_id: "org-1",
    title: "Vendor concentration in payments",
    description: null,
    domain: "Cyber",
    likelihood: "possible",
    impact: "High",
    risk_rating: "High",
    inherent_likelihood: null,
    inherent_impact: null,
    inherent_rating: null,
    residual_likelihood: null,
    residual_impact: null,
    residual_rating: "High",
    status: "open",
    treatment: null,
    owner: null,
    owner_user_id: null,
    due_date: null,
    source_type: null,
    source_id: null,
    last_reviewed_at: null,
    next_review_due: null,
    review_cadence_days: null,
    is_overdue: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ON_REGISTER: Risk[] = [
  aRisk({ id: "r-1", title: "Vendor concentration in payments", status: "open" }),
  aRisk({ id: "r-2", title: "Unreviewed model deployment", status: "accepted" }),
];

const aRisksResponse = (risks: Risk[]): RisksResponse => ({
  count: risks.length,
  limit: 200,
  organizationId: "org-1",
  nextCursor: null,
  risks,
});

const aRisksSummary = (o: Partial<RisksSummary> = {}): RisksSummary => ({
  total: 4,
  open_critical_count: 0,
  by_status: { open: 1, accepted: 1, closed: 1, transferred: 1 },
  by_risk_rating: { High: 2 },
  by_inherent_rating: {},
  by_residual_rating: { High: 2 },
  by_domain: { Cyber: 2 },
  overdue_review_count: 0,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getRisks.mockResolvedValue(aRisksResponse(ON_REGISTER));
  api.getRisksIntelligence.mockResolvedValue(null);
  api.getRisksSummary.mockResolvedValue(aRisksSummary());
  api.getRiskScale.mockResolvedValue(null);
});

describe("/risks — the destination of the Open Risks tile", () => {
  it("?active=true asks the engine for the risks still ON the register", async () => {
    await renderPage(RisksPage, { searchParams: sp({ active: "true" }) });

    expect(api.getRisks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ active: true })
    );
  });

  it("without ?active=true the list is unfiltered — the escape hatch still exists", async () => {
    await renderPage(RisksPage, { searchParams: sp({}) });

    const params = api.getRisks.mock.calls[0][1];
    expect(params.active).toBeUndefined();
  });

  it("?active=true is a VISIBLE filter, not a silent one under a highlighted 'All'", async () => {
    const { container } = await renderPage(RisksPage, { searchParams: sp({ active: "true" }) });

    // Labelled "On the register" — the archived axis already spends the word "Active"
    // on a different meaning, and two pills named Active would be a lie about one of them.
    const pill = hrefOf(container, "On the register");
    expect(pill).toContain("active=true");

    const all = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "All"
    );
    expect(all?.getAttribute("href")).not.toContain("active=true");
  });

  it("preserves the active filter when the customer refines by domain", async () => {
    const { container } = await renderPage(RisksPage, { searchParams: sp({ active: "true" }) });

    // Dropping `active` on a refinement click silently widens the list back to closed
    // and transferred risks — the count jumps for no visible reason.
    const vendorRisk = hrefOf(container, /^Vendor Risk$/);
    expect(vendorRisk).toContain("active=true");
    expect(vendorRisk).toContain("domain=Vendor+Risk");
  });

  it("an explicit status REPLACES the active set rather than intersecting with it", async () => {
    const { container } = await renderPage(RisksPage, { searchParams: sp({ active: "true" }) });

    // The engine ANDs them, so active=true&status=closed is an empty list under a
    // highlighted "Closed" pill — a dead end.
    const closed = hrefOf(container, /^Closed$/);
    if (closed) expect(closed).not.toContain("active=true");
  });

  it("renders the risks the engine returned", async () => {
    await renderPage(RisksPage, { searchParams: sp({ active: "true" }) });

    expect(screen.getByText(/Vendor concentration in payments/)).toBeInTheDocument();
    expect(screen.getByText(/Unreviewed model deployment/)).toBeInTheDocument();
  });
});

describe("/risks — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(RisksPage, { searchParams: sp({}) })).toBe("/login");
  });

  it("sends a non-platform (unentitled) user to /dashboard, not into the page", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));
    expect(await expectRedirect(RisksPage, { searchParams: sp({}) })).toBe("/dashboard");
  });
});
