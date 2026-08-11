/**
 * /vendors/risk — the risk board describes the portfolio, not the page.
 *
 * Every number and every state on this surface came from a bounded read:
 *
 *   * Critical / High / Total Active and the criticality distribution were
 *     tallied from the ≤100-row vendor page, so an org past the cap saw the
 *     shape of its first page drawn as the shape of its portfolio and "Total
 *     Active" printed the cap itself;
 *   * "Need Assessment", the per-row "Never assessed" label, the red risk
 *     border, and the whole Requires Attention list came from
 *     getVendorAssessments(limit:100) — an ORG-wide cap answering a PER-VENDOR
 *     question. Past 100 assessments in the org, an assessed vendor dropped out
 *     of that page and was accused of never having been assessed.
 *
 * The second one is the serious defect: it is not a wrong number, it is a false
 * statement about the customer's own records, rendered in red, on the board
 * leadership reads.
 *
 * PRODUCT RULING held here: "assessed" still means AT LEAST ONE ROW in
 * vendor_assessments. Un-capping a number must not redefine the metric —
 * `last_reviewed_at` is NOT substituted.
 *
 * Every population below is seeded PAST the cap. A 20-row fixture proves
 * nothing here — capped arithmetic is correct until it isn't.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, expectRedirect } from "@/test/harness";
import { aVendor } from "@/test/fixtures";
import type { Vendor, VendorsResponse } from "@/lib/api";

const api = vi.hoisted(() => ({
  getVendors: vi.fn(),
  getVendorAssessments: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import VendorRiskPage from "../page";

/**
 * An org holding 340 active vendors — the register the tiles must describe.
 * The engine returns at most 100 of them.
 */
const REGISTER = { critical: 140, high: 90, medium: 70, low: 40, uncategorized: 0 };
const REGISTER_TOTAL = 340;
const NEVER_ASSESSED = 137;

/**
 * The page the engine hands back: 100 rows, all `low`. Deliberately the WRONG
 * shape for the register above, so any tile that tallies rows is visible
 * immediately rather than inferred from call shapes.
 */
const CAPPED_PAGE: Vendor[] = Array.from({ length: 100 }, (_, i) =>
  aVendor({
    id: `v-${i}`,
    name: `Vendor ${i}`,
    criticality: "low",
    assessment_count: 1,
    latest_assessment_at: "2026-05-01T00:00:00.000Z",
    active_findings_count: 0,
  })
);

function response(
  vendors: Vendor[],
  over: Partial<VendorsResponse> = {}
): VendorsResponse {
  return {
    count: vendors.length,
    limit: 100,
    total: REGISTER_TOTAL,
    by_criticality: { ...REGISTER },
    never_assessed_count: NEVER_ASSESSED,
    organizationId: "org-1",
    statusFilter: "active",
    nextCursor: null,
    vendors,
    ...over,
  };
}

function engine(vendors: Vendor[] = CAPPED_PAGE, over: Partial<VendorsResponse> = {}) {
  api.getVendors.mockResolvedValue(response(vendors, over));
}

/** The value rendered inside the tile whose label is `label`. */
function tile(container: HTMLElement, label: string): string {
  const el = Array.from(container.querySelectorAll("a")).find((a) =>
    (a.textContent ?? "").startsWith(label)
  );
  if (!el) throw new Error(`No tile labelled "${label}"`);
  return (el.textContent ?? "").slice(label.length).trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  engine();
  api.getVendorAssessments.mockResolvedValue({ assessments: [] });
});

// ─────────────────────────────────────────────────────────────

describe("/vendors/risk — the tiles count the register, not the page", () => {
  it("prints the engine's exact counts, not a tally of the 100 returned rows", async () => {
    const { container } = await renderPage(VendorRiskPage, undefined as never);

    // Tallying the page gives Critical 0, High 0, Total 100: the slice is 100
    // `low` vendors, so two tiles lose their count entirely and the third
    // reports the cap as though it were the portfolio.
    expect(tile(container, "Critical Vendors")).toBe("140");
    expect(tile(container, "High Risk")).toBe("90");
    expect(tile(container, "Total Active")).toBe("340");
  });

  it("Need Assessment is exact across the whole tenant, not a scan of a capped assessment page", async () => {
    const { container } = await renderPage(VendorRiskPage, undefined as never);
    expect(tile(container, "Need Assessment")).toBe("137");
  });

  it("more vendors than the cap does not move any of the four numbers", async () => {
    // The slice grows and shrinks; the register does not. The tiles must not
    // notice — that is the whole contract.
    for (const sliceSize of [1, 25, 100]) {
      vi.clearAllMocks();
      signedIn();
      engine(CAPPED_PAGE.slice(0, sliceSize));
      const { container, unmount } = await renderPage(VendorRiskPage, undefined as never);
      expect(tile(container, "Critical Vendors")).toBe("140");
      expect(tile(container, "High Risk")).toBe("90");
      expect(tile(container, "Need Assessment")).toBe("137");
      expect(tile(container, "Total Active")).toBe("340");
      unmount();
    }
  });

  it("never derives Need Assessment from last_reviewed_at — the rows carry a date and are still counted", async () => {
    // Every row here HAS a last_reviewed_at (the fixture default) and has been
    // assessed. If the page had switched metrics, the tile would follow the
    // review field instead of the engine's assessment aggregate.
    const { container } = await renderPage(VendorRiskPage, undefined as never);
    expect(tile(container, "Need Assessment")).toBe("137");
    // And the page must not be asking a review-recency question at all.
    for (const call of api.getVendors.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("reviewed");
    }
  });
});

describe("/vendors/risk — the criticality distribution describes the register", () => {
  it("draws the engine's breakdown, not the shape of the returned page", async () => {
    const { container } = await renderPage(VendorRiskPage, undefined as never);

    const legend = Array.from(container.querySelectorAll("a"))
      .map((a) => a.textContent ?? "")
      .filter((t) => /^(Critical|High|Medium|Low|None set)\d/.test(t));

    // Tallying the page would give a single "Low 100" segment and erase the
    // other four bands from the chart entirely.
    expect(legend).toContain("Critical140");
    expect(legend).toContain("High90");
    expect(legend).toContain("Medium70");
    expect(legend).toContain("Low40");
  });

  it("an absent breakdown says so instead of drawing a bar out of the page", async () => {
    engine(CAPPED_PAGE, { by_criticality: undefined });
    const { container } = await renderPage(VendorRiskPage, undefined as never);

    expect(
      screen.getByText(/criticality distribution couldn.t be loaded/i)
    ).toBeTruthy();
    // No fabricated segments.
    const legend = Array.from(container.querySelectorAll("a"))
      .map((a) => a.textContent ?? "")
      .filter((t) => /^(Critical|High|Medium|Low|None set)\d/.test(t));
    expect(legend).toHaveLength(0);
  });
});

describe("/vendors/risk — an unknown count is a dash, never a zero", () => {
  it("renders the shared unknown marker and the disclosure when aggregates are absent", async () => {
    engine(CAPPED_PAGE, {
      total: undefined,
      by_criticality: undefined,
      never_assessed_count: undefined,
    });
    const { container } = await renderPage(VendorRiskPage, undefined as never);

    expect(tile(container, "Critical Vendors")).toBe("—");
    expect(tile(container, "Need Assessment")).toBe("—");
    expect(tile(container, "Total Active")).toBe("—");
    // The dash is the marker; this sentence is the disclosure.
    expect(screen.getByText(/couldn.t be loaded and are shown as/i)).toBeTruthy();
  });

  it("does not print the disclosure when every count is known", async () => {
    await renderPage(VendorRiskPage, undefined as never);
    expect(screen.queryByText(/couldn.t be loaded and are shown as/i)).toBeNull();
  });

  it("a genuinely empty register still reads as zero, not unknown", async () => {
    engine([], {
      total: 0,
      by_criticality: { critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0 },
      never_assessed_count: 0,
    });
    const { container } = await renderPage(VendorRiskPage, undefined as never);

    expect(tile(container, "Total Active")).toBe("0");
    expect(tile(container, "Need Assessment")).toBe("0");
    expect(screen.queryByText(/couldn.t be loaded and are shown as/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────

describe("/vendors/risk — assessed state is per-vendor and uncapped", () => {
  it("an assessed vendor is never called 'Never assessed' because of a capped assessment page", async () => {
    // The org holds far more than 100 assessments; this critical vendor's rows
    // are nowhere near the first page. Under the old code it was invisible in
    // the assessment map and therefore accused of never having been assessed.
    const assessed = aVendor({
      id: "v-deep",
      name: "Deep Assessed Vendor",
      criticality: "critical",
      assessment_count: 3,
      latest_assessment_at: "2026-05-01T00:00:00.000Z",
      active_findings_count: 0,
    });
    engine([assessed], { by_criticality: { ...REGISTER, critical: 1, high: 0, medium: 0, low: 0 }, total: 1 });
    // The assessments endpoint returns a page this vendor is absent from.
    api.getVendorAssessments.mockResolvedValue({ assessments: [] });

    await renderPage(VendorRiskPage, undefined as never);

    expect(screen.queryByText("Never assessed")).toBeNull();
    expect(screen.getByText("May 1, 2026")).toBeTruthy();
  });

  it("the page no longer reads the capped org-wide assessment list at all", async () => {
    await renderPage(VendorRiskPage, undefined as never);
    expect(api.getVendorAssessments).not.toHaveBeenCalled();
  });

  it("a genuinely never-assessed high-risk vendor still renders the accusation", async () => {
    const unassessed = aVendor({
      id: "v-new",
      name: "Unassessed Vendor",
      criticality: "critical",
      assessment_count: 0,
      latest_assessment_at: null,
      active_findings_count: 0,
    });
    engine([unassessed], { by_criticality: { critical: 1, high: 0, medium: 0, low: 0, uncategorized: 0 }, total: 1 });

    const { container } = await renderPage(VendorRiskPage, undefined as never);

    expect(screen.getAllByText("Never assessed").length).toBeGreaterThan(0);
    // And it is flagged: the red border is the visual claim that goes with it.
    const row = container.querySelector("tbody tr") as HTMLElement;
    expect(row.style.borderLeft).toMatch(/rgba\(239,\s*68,\s*68/);
  });

  it("unknown assessed state is NOT rendered as 'Never assessed' and draws no red border", async () => {
    // An older engine build omits assessment_count. Unknown must stay unknown.
    const unknown = aVendor({
      id: "v-unknown",
      name: "Unknown State Vendor",
      criticality: "critical",
      assessment_count: undefined,
      latest_assessment_at: undefined,
      active_findings_count: 0,
    });
    engine([unknown], { by_criticality: { critical: 1, high: 0, medium: 0, low: 0, uncategorized: 0 }, total: 1 });

    const { container } = await renderPage(VendorRiskPage, undefined as never);

    expect(screen.queryByText("Never assessed")).toBeNull();
    const row = container.querySelector("tbody tr") as HTMLElement;
    expect(row.style.borderLeft).toBe("");
    // It says "unavailable — not a zero", in the shared vocabulary.
    expect(
      container.querySelector('[aria-label*="Last assessment is unavailable"]')
    ).toBeTruthy();
  });
});

describe("/vendors/risk — Requires Attention is never fabricated", () => {
  it("lists a genuinely never-assessed high-risk vendor", async () => {
    const unassessed = aVendor({
      id: "v-new", name: "Unassessed Vendor", criticality: "critical",
      assessment_count: 0, latest_assessment_at: null, active_findings_count: 0,
    });
    engine([unassessed], { by_criticality: { critical: 1, high: 0, medium: 0, low: 0, uncategorized: 0 }, total: 1 });

    await renderPage(VendorRiskPage, undefined as never);
    expect(screen.getByText("Review →")).toBeTruthy();
  });

  it("does not conjure an entry from unknown assessment state", async () => {
    const unknown = aVendor({
      id: "v-unknown", name: "Unknown State Vendor", criticality: "critical",
      assessment_count: undefined, active_findings_count: 0,
    });
    engine([unknown], { by_criticality: { critical: 1, high: 0, medium: 0, low: 0, uncategorized: 0 }, total: 1 });

    await renderPage(VendorRiskPage, undefined as never);
    expect(screen.queryByText("Review →")).toBeNull();
  });

  it("withholds the all-clear when the assessed state of a high-risk vendor is unknown", async () => {
    const unknown = aVendor({
      id: "v-unknown", name: "Unknown State Vendor", criticality: "critical",
      assessment_count: undefined, active_findings_count: 0,
    });
    engine([unknown], { by_criticality: { critical: 1, high: 0, medium: 0, low: 0, uncategorized: 0 }, total: 1 });

    await renderPage(VendorRiskPage, undefined as never);

    // "No high-risk vendors need immediate attention" is a CLAIM, and it cannot
    // be made over a vendor whose state never loaded.
    expect(screen.queryByText(/No high-risk vendors need immediate attention/i)).toBeNull();
    expect(screen.getByText(/isn.t an all-clear/i)).toBeTruthy();
  });

  it("withholds the all-clear when high-risk vendors exist beyond the loaded page", async () => {
    // 230 critical+high in the register, 100 rows loaded: the list cannot
    // possibly hold every candidate, so silence is not evidence of safety.
    await renderPage(VendorRiskPage, undefined as never);
    expect(screen.queryByText(/No high-risk vendors need immediate attention/i)).toBeNull();
    expect(screen.getByText(/isn.t an all-clear/i)).toBeTruthy();
  });

  it("gives the all-clear only when every high-risk vendor was loaded and known", async () => {
    const safe = aVendor({
      id: "v-ok", name: "Assessed Vendor", criticality: "critical",
      assessment_count: 2, latest_assessment_at: "2026-05-01T00:00:00.000Z",
      active_findings_count: 0,
    });
    engine([safe], { by_criticality: { critical: 1, high: 0, medium: 0, low: 0, uncategorized: 0 }, total: 1 });

    await renderPage(VendorRiskPage, undefined as never);
    expect(screen.getByText(/No high-risk vendors need immediate attention/i)).toBeTruthy();
  });

  it("discloses incompleteness beneath a populated list it cannot prove complete", async () => {
    const rows = [
      aVendor({ id: "v-bad", name: "Flagged", criticality: "critical", assessment_count: 0, active_findings_count: 0 }),
      ...CAPPED_PAGE.slice(0, 99),
    ];
    engine(rows); // register still holds 230 critical+high
    await renderPage(VendorRiskPage, undefined as never);

    expect(screen.getByText(/More vendors may need attention than are listed here/i)).toBeTruthy();
  });
});

describe("/vendors/risk — the table says which rows it holds", () => {
  it("stops calling a 100-row page 'All Vendors' when the register is larger", async () => {
    await renderPage(VendorRiskPage, undefined as never);

    expect(screen.queryByText("All Vendors")).toBeNull();
    expect(screen.getByText(/Showing 100 of 340/)).toBeTruthy();
  });

  it("keeps 'All Vendors' when the page really is the whole register", async () => {
    engine(CAPPED_PAGE.slice(0, 10), {
      total: 10,
      by_criticality: { critical: 0, high: 0, medium: 0, low: 10, uncategorized: 0 },
    });
    await renderPage(VendorRiskPage, undefined as never);

    expect(screen.getByText("All Vendors")).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });
});

describe("/vendors/risk — preserved behaviour", () => {
  it("an unavailable register still fails honestly, without blaming the plan", async () => {
    api.getVendors.mockResolvedValue(null);
    await renderPage(VendorRiskPage, undefined as never);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/not a limit of your plan/i)).toBeTruthy();
  });

  it("an empty register keeps its add-vendor empty state", async () => {
    engine([], {
      total: 0,
      by_criticality: { critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0 },
      never_assessed_count: 0,
    });
    await renderPage(VendorRiskPage, undefined as never);
    expect(screen.getByText(/No active vendors/i)).toBeTruthy();
    expect(screen.getByText("+ Add Vendor")).toBeTruthy();
  });

  it("tile navigation is unchanged", async () => {
    const { container } = await renderPage(VendorRiskPage, undefined as never);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/vendors?criticality=critical");
    expect(hrefs).toContain("/vendors?criticality=high");
    expect(hrefs).toContain("/vendors");
  });

  it("only the caller's own org is ever read — the page passes the session token and no org id", async () => {
    signedIn({ jwtToken: "tenant-a-jwt", organizationId: "org-a" });
    await renderPage(VendorRiskPage, undefined as never);

    expect(api.getVendors).toHaveBeenCalledTimes(1);
    const [token, status] = api.getVendors.mock.calls[0]!;
    expect(token).toBe("tenant-a-jwt");
    expect(status).toBe("active");
    // No org id is passed from the client: scoping is the engine's, off the
    // token. A page that could name an org could name someone else's.
    expect(api.getVendors.mock.calls[0]!.length).toBeLessThanOrEqual(2);
  });

  it("an unentitled caller is still redirected before any vendor read", async () => {
    signedIn({ entitlementLevel: "free" });
    expect(await expectRedirect(VendorRiskPage, undefined as never)).toBe("/dashboard");
    expect(api.getVendors).not.toHaveBeenCalled();
  });

  it("a signed-out caller is still sent to login", async () => {
    signedIn({ jwtToken: undefined, apiKey: undefined });
    expect(await expectRedirect(VendorRiskPage, undefined as never)).toBe("/login");
    expect(api.getVendors).not.toHaveBeenCalled();
  });
});
