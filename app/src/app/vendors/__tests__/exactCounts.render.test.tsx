/**
 * /vendors — the register counts describe the register, not the page.
 *
 * Every number on this surface was derived from the ≤100-row slice the engine
 * returned: the criticality pills, the review pill, the "N active" chip, and —
 * worst — the M in "Showing N of M", where the same idiom on /actions means a
 * true total. A cap counted as a population is not a small error; it is a
 * confident wrong number that stops being wrong only for orgs small enough not
 * to notice.
 *
 * The filters were also applied to the fetched page rather than in SQL, so past
 * the cap a filtered view omitted matching vendors outright. Aggregates and
 * rows had to move together: an exact count above a client-filtered slice would
 * only have produced a new contradiction.
 *
 * RULING (2026-08-09) — the review axis was then found to be counting a
 * DEFINITION, not just a population. The old "Never reviewed" pill filtered
 * `last_reviewed_at IS NULL`, and nothing in the product ever writes that
 * column, so an exact engine-computed count reported ~the entire register as
 * unreviewed. Exactness cannot rescue a meaningless predicate. The axis is now
 * "Never assessed" = zero rows in vendor_assessments, and the pill's label,
 * count, and destination are held to ONE population by these tests.
 *
 * Every population below is seeded PAST the cap. A 20-row fixture proves
 * nothing here — capped arithmetic is correct until it isn't.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
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

import VendorsPage from "../page";

/** A full page — all the engine will ever hand this route. */
const CAPPED_PAGE: Vendor[] = Array.from({ length: 100 }, (_, i) =>
  aVendor({ id: `v-${i}`, name: `Vendor ${i}`, criticality: "low" })
);

function response(
  vendors: Vendor[],
  total: number,
  by: Partial<VendorsResponse["by_criticality"]> = {},
  neverAssessed = 0
): VendorsResponse {
  return {
    count: vendors.length,
    limit: 100,
    total,
    by_criticality: {
      critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0, ...by,
    },
    never_assessed_count: neverAssessed,
    organizationId: "org-1",
    statusFilter: "active",
    nextCursor: null,
    vendors,
  };
}

/**
 * An org holding 340 active vendors. The mock keys on the filter set, exactly
 * as the engine does — so a page that forgets to send a filter gets the wrong
 * population back, which is the failure these tests are looking for.
 */
const REGISTER = { critical: 140, high: 90, medium: 70, low: 40, uncategorized: 0 };
const REGISTER_TOTAL = 340;
/** The never-ASSESSED slice of that register — deliberately a DIFFERENT shape. */
const NEVER_ASSESSED = { critical: 55, high: 30, medium: 20, low: 10, uncategorized: 0 };
const NEVER_ASSESSED_TOTAL = 115;

const sum = (b: typeof REGISTER) => b.critical + b.high + b.medium + b.low + b.uncategorized;

/**
 * The engine, keyed on the FILTER SET exactly as SQL is — including
 * `never_assessed_count`, which it computes over whatever population the
 * response describes.
 *
 * The never-assessed breakdown differs from the register's, so which population
 * the page asked for is visible in the rendered pills rather than inferred from
 * call shapes. And because the mock derives the count the same way the engine
 * does, a page that prints one population's count while linking to another's
 * list shows up as a mismatch here.
 */
function engine(rows: Vendor[] = CAPPED_PAGE) {
  api.getVendors.mockImplementation(
    (_t: unknown, status: string, opts: { criticality?: string; assessed?: string } = {}) => {
      if (status === "archived") return Promise.resolve(response([], 12, { low: 12 }, 4));
      const assessedOnly = opts.assessed === "never";
      const base = assessedOnly ? NEVER_ASSESSED : REGISTER;
      if (opts.criticality) {
        const k = opts.criticality as keyof typeof base;
        const n = base[k];
        // Under ?assessed=never the population IS the never-assessed one, so
        // the aggregate equals the total — exactly as the engine returns it.
        return Promise.resolve(response(rows, n, { [k]: n }, NEVER_ASSESSED[k]));
      }
      return Promise.resolve(
        response(rows, sum(base), base, sum(NEVER_ASSESSED))
      );
    }
  );
}

/** The text of the pill whose label starts with `prefix`. */
function pill(container: HTMLElement, prefix: string): string {
  const el = Array.from(container.querySelectorAll("a")).find((a) =>
    (a.textContent ?? "").startsWith(prefix)
  );
  if (!el) throw new Error(`No pill starting with "${prefix}"`);
  return el.textContent?.trim() ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  engine();
  api.getVendorAssessments.mockResolvedValue({ assessments: [] });
});

describe("/vendors — criticality pills count the register", () => {
  it("prints the engine's exact per-band counts, not a tally of the 100 rows", async () => {
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    // Tallying the returned page gives Critical (0) … Low (100): the page is
    // 100 `low` vendors, so three pills lose their count entirely and the
    // fourth reports the cap.
    expect(pill(container, "Critical")).toBe("Critical (140)");
    expect(pill(container, "High")).toBe("High (90)");
    expect(pill(container, "Medium")).toBe("Medium (70)");
    expect(pill(container, "Low")).toBe("Low (40)");
  });

  it("counts the population each pill NAVIGATES to — the number is reproducible by clicking", async () => {
    // With ?assessed=never active, "Critical" links to
    // ?criticality=critical&assessed=never, so it must count THAT population.
    // Printing the register's 140 would put a number on a pill that clicking it
    // can never reproduce.
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ assessed: "never" }),
    });

    expect(pill(container, "Critical")).toBe("Critical (55)");
    expect(pill(container, "High")).toBe("High (30)");
    expect(pill(container, "Critical")).not.toBe("Critical (140)");
  });

  it("the 'Never assessed' pill is counted with the criticality filter applied", async () => {
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "critical" }),
    });

    // Its href is /vendors?criticality=critical&assessed=never, so its count is
    // of that population (55) — not of every never-assessed vendor (115).
    expect(pill(container, "Never assessed")).toBe("Never assessed (55)");
  });

  it("the unfiltered register shows the whole-register breakdown and total", async () => {
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(pill(container, "Never assessed")).toBe("Never assessed (115)");
    expect(container.textContent).toMatch(/340 active/);
  });

  it("an unknown breakdown omits the count rather than printing (0)", async () => {
    // An engine build without the aggregate. "(0)" would be a claim about the
    // register; silence is the only honest label.
    api.getVendors.mockResolvedValue({
      ...response(CAPPED_PAGE, REGISTER_TOTAL, REGISTER),
      by_criticality: undefined,
      total: undefined,
    });

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(pill(container, "Critical")).toBe("Critical");
    expect(pill(container, "Critical")).not.toContain("(0)");
    expect(screen.getByText(/shown as/)).toBeInTheDocument();
  });
});

describe("/vendors — filtering happens in SQL, not over the page", () => {
  it("sends the criticality filter to the engine", async () => {
    await renderPage(VendorsPage, { searchParams: sp({ criticality: "critical" }) });

    // Filtering the fetched page could only ever narrow 100 rows, so a critical
    // vendor past the cap was absent from the "Critical" view entirely.
    const listCall = api.getVendors.mock.calls.find(
      (c) => c[1] === "active" && c[2]?.criticality === "critical" && c[2]?.limit !== 1
    );
    expect(listCall).toBeDefined();
  });

  it("sends the never-assessed filter to the engine", async () => {
    await renderPage(VendorsPage, { searchParams: sp({ assessed: "never" }) });

    const listCall = api.getVendors.mock.calls.find(
      (c) => c[1] === "active" && c[2]?.assessed === "never" && c[2]?.limit !== 1
    );
    expect(listCall).toBeDefined();
  });

  it("composes both axes in one engine request", async () => {
    await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "high", assessed: "never" }),
    });

    const listCall = api.getVendors.mock.calls.find(
      (c) => c[2]?.criticality === "high" && c[2]?.assessed === "never" && c[2]?.limit !== 1
    );
    expect(listCall).toBeDefined();
  });

  it("never sends the legacy reviewed=never filter — no surface may use it", async () => {
    // RULING: last_reviewed_at is written by nothing, so ?reviewed=never counts
    // a column that is NULL for effectively every vendor. The engine keeps the
    // filter for API compatibility; this page must not reach for it on any
    // path, including when an old bookmark carries the param.
    for (const params of [{}, { assessed: "never" }, { reviewed: "never" }]) {
      vi.clearAllMocks();
      signedIn();
      engine();
      await renderPage(VendorsPage, { searchParams: sp(params) });
      for (const call of api.getVendors.mock.calls) {
        expect(call[2]?.reviewed).toBeUndefined();
      }
    }
  });
});

describe("/vendors — 'Showing N of M' discloses a real truncation", () => {
  it("M is the engine's filtered total, not the page length", async () => {
    await renderPage(VendorsPage, { searchParams: sp({ criticality: "critical" }) });

    // M was `allVendors.length` — N's own ceiling — so the sentence could only
    // ever read "Showing 100 of 100" and never disclosed anything.
    expect(screen.getByText(/Showing 100 of 140 vendors/)).toBeInTheDocument();
  });

  it("the banner states the exact filtered population", async () => {
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "critical" }),
    });

    expect(container.textContent).toMatch(/140 Critical vendors/);
  });

  it("the header chip is the exact active total, not the rows returned", async () => {
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(container.textContent).toMatch(/340 active/);
    expect(container.textContent).not.toMatch(/100 active/);
  });

  it("an unavailable total is disclosed rather than replaced by the page length", async () => {
    api.getVendors.mockImplementation((_t: unknown, status: string) =>
      Promise.resolve(
        status === "archived"
          ? null
          : { ...response(CAPPED_PAGE, 0, REGISTER), total: undefined }
      )
    );

    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "critical" }),
    });

    expect(container.textContent).not.toMatch(/Showing 100 of 100/);
    expect(container.textContent).toMatch(/couldn’t be loaded/);
  });
});

describe("/vendors — zero and unknown stay distinct", () => {
  it("a true zero for a band is a real answer: the pill simply carries no count", async () => {
    api.getVendors.mockResolvedValue(
      response([], 0, { critical: 0, high: 0, medium: 0, low: 0 })
    );

    await renderPage(VendorsPage, { searchParams: sp({}) });

    // An empty register is an ANSWER, and gets the ordinary empty state — no
    // outage language anywhere on the page.
    expect(screen.getByText(/Add your first vendor/)).toBeInTheDocument();
    expect(screen.queryByText(/shown as/)).not.toBeInTheDocument();
  });

  it("a filtered view that matches nothing says so, and never invites a first vendor", async () => {
    api.getVendors.mockImplementation(
      (_t: unknown, _s: string, opts: { criticality?: string } = {}) =>
        Promise.resolve(
          opts.criticality
            ? response([], 0, {})
            : response(CAPPED_PAGE, REGISTER_TOTAL, REGISTER)
        )
    );

    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "critical" }),
    });

    expect(screen.getByText(/No Critical vendors/)).toBeInTheDocument();
    // The org has 340 vendors. "Add your first vendor" here would be a
    // confident falsehood about the customer's own register.
    expect(screen.queryByText(/Add your first vendor/)).not.toBeInTheDocument();
    // And the filter that emptied the page must not remove the way out of it.
    expect(container.textContent).toMatch(/View all/);
    expect(pill(container, "Critical")).toBe("Critical (140)");
  });

  it("a failed register read is an outage, not an empty register", async () => {
    api.getVendors.mockResolvedValue(null);

    await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(screen.getByRole("alert").textContent).toMatch(/Vendors couldn’t be loaded/);
    expect(screen.queryByText(/Add your first vendor/)).not.toBeInTheDocument();
  });
});

describe("/vendors — pagination cannot move an aggregate", () => {
  it("the same register reported through a smaller page yields identical counts", async () => {
    const read = async () => {
      const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
      return [
        pill(container, "Critical"),
        pill(container, "High"),
        pill(container, "Never assessed"),
        (container.textContent?.match(/(\d+) active/) ?? [])[1],
      ];
    };

    engine(CAPPED_PAGE);
    const fromFullPage = await read();

    // Same populations, three rows returned instead of a hundred.
    engine(CAPPED_PAGE.slice(0, 3));

    expect(await read()).toEqual(fromFullPage);
    expect(fromFullPage).toEqual([
      "Critical (140)",
      "High (90)",
      `Never assessed (${NEVER_ASSESSED_TOTAL})`,
      String(REGISTER_TOTAL),
    ]);
  });
});

/**
 * The truth invariant, stated directly: a pill's LABEL, its COUNT, and the
 * POPULATION its link reaches must be the same thing.
 *
 * This is the seam the ruling exists to protect. An authoritative count that
 * navigates to a differently-defined list is worse than a capped count, because
 * both halves look equally trustworthy and nothing on screen betrays the
 * mismatch.
 */
describe("/vendors — the Never assessed pill: label, count, destination", () => {
  it("links to ?assessed=never, carrying the other axes", async () => {
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "critical", q: "acme" }),
    });

    const el = Array.from(container.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").startsWith("Never assessed")
    )!;
    const href = el.getAttribute("href")!;
    expect(href).toContain("assessed=never");
    expect(href).not.toContain("reviewed=never");
    // The other axes survive the click.
    expect(href).toContain("criticality=critical");
    expect(href).toContain("q=acme");
  });

  it("the printed count equals the total of the list that link reaches", async () => {
    // Read the pill on the unfiltered register...
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    const printed = pill(container, "Never assessed");
    expect(printed).toBe(`Never assessed (${NEVER_ASSESSED_TOTAL})`);

    // ...then follow it, and count what actually arrives.
    vi.clearAllMocks();
    signedIn();
    engine();
    const followed = await renderPage(VendorsPage, {
      searchParams: sp({ assessed: "never" }),
    });
    expect(followed.container.textContent).toMatch(
      new RegExp(`${NEVER_ASSESSED_TOTAL} active`)
    );
  });

  it("toggles off by dropping the param, not by switching predicate", async () => {
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ assessed: "never" }),
    });
    const el = Array.from(container.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").startsWith("Never assessed")
    )!;
    expect(el.getAttribute("href")).not.toContain("assessed=never");
  });

  it("an unavailable aggregate omits the count — it is never rendered as (0)", async () => {
    api.getVendors.mockResolvedValue({
      ...response(CAPPED_PAGE, REGISTER_TOTAL, REGISTER),
      never_assessed_count: undefined,
    });

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    // "(0)" would state that every vendor has been assessed — the most
    // reassuring possible lie on a TPRM surface.
    expect(pill(container, "Never assessed")).toBe("Never assessed");
    expect(pill(container, "Never assessed")).not.toContain("(0)");
    expect(screen.getByText(/shown as/)).toBeInTheDocument();
  });

  it("a true zero is an answer: no count on the pill, and no outage language", async () => {
    api.getVendors.mockResolvedValue(
      response(CAPPED_PAGE, REGISTER_TOTAL, REGISTER, 0)
    );

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(pill(container, "Never assessed")).toBe("Never assessed");
    expect(screen.queryByText(/shown as/)).not.toBeInTheDocument();
  });

  it("the old wording is gone from the corrected surface", async () => {
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    expect(container.textContent).not.toMatch(/Never reviewed/i);
    expect(container.textContent).not.toMatch(/\bReviewed\b/);
    expect(container.textContent).toMatch(/Never assessed/);
  });
});

describe("/vendors — per-row assessment state is exact and uncapped", () => {
  it("an assessed vendor beyond the capped assessment page is not called 'No assessments'", async () => {
    const deep = aVendor({
      id: "v-deep", name: "Deep Vendor", criticality: "critical",
      assessment_count: 4, latest_assessment_at: "2026-05-01T00:00:00.000Z",
    });
    api.getVendors.mockResolvedValue(
      response([deep], 1, { critical: 1 }, 0)
    );

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(container.textContent).toMatch(/4 assessments/);
    expect(container.textContent).toMatch(/Assessed May 1, 2026/);
    expect(container.textContent).not.toMatch(/No assessments/);
    expect(container.textContent).not.toMatch(/Never assessed$/m);
  });

  it("the page no longer reads the capped org-wide assessment list", async () => {
    await renderPage(VendorsPage, { searchParams: sp({}) });
    expect(api.getVendorAssessments).not.toHaveBeenCalled();
  });

  it("a genuinely unassessed vendor still says so", async () => {
    const fresh = aVendor({
      id: "v-new", name: "Fresh Vendor", assessment_count: 0, latest_assessment_at: null,
    });
    api.getVendors.mockResolvedValue(response([fresh], 1, { high: 1 }, 1));

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    expect(container.textContent).toMatch(/No assessments/);
    expect(container.textContent).toMatch(/Never assessed/);
  });

  it("unknown per-vendor state is a dash, not an accusation", async () => {
    const unknown = aVendor({
      id: "v-unknown", name: "Unknown Vendor", assessment_count: undefined,
    });
    api.getVendors.mockResolvedValue(response([unknown], 1, { high: 1 }, 0));

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(container.textContent).not.toMatch(/No assessments/);
    expect(
      container.querySelector('[aria-label*="Assessment state is unavailable"]')
    ).toBeTruthy();
  });
});
