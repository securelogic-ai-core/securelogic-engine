/**
 * /vendors — the register counts describe the register, not the page.
 *
 * Every number on this surface was derived from the ≤100-row slice the engine
 * returned: the criticality pills, the "Never reviewed" pill, the "N active"
 * chip, and — worst — the M in "Showing N of M", where the same idiom on
 * /actions means a true total. A cap counted as a population is not a small
 * error; it is a confident wrong number that stops being wrong only for orgs
 * small enough not to notice.
 *
 * Criticality and "never reviewed" were also applied to the fetched page rather
 * than in SQL, so past the cap a filtered view omitted matching vendors
 * outright. Aggregates and rows had to move together: an exact count above a
 * client-filtered slice would only have produced a new contradiction.
 *
 * Every population below is therefore seeded PAST the cap. A 20-row fixture
 * proves nothing here — capped arithmetic is correct until it isn't.
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
  by: Partial<VendorsResponse["by_criticality"]> = {}
): VendorsResponse {
  return {
    count: vendors.length,
    limit: 100,
    total,
    by_criticality: {
      critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0, ...by,
    },
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
/** The never-reviewed slice of that register — deliberately a DIFFERENT shape. */
const NEVER_REVIEWED = { critical: 55, high: 30, medium: 20, low: 10, uncategorized: 0 };
const NEVER_REVIEWED_TOTAL = 115;

const sum = (b: typeof REGISTER) => b.critical + b.high + b.medium + b.low + b.uncategorized;

/**
 * The engine, keyed on the FILTER SET exactly as SQL is. The never-reviewed
 * breakdown differs from the register's, so which population the page asked for
 * is visible in the rendered pills rather than inferred from call shapes.
 */
function engine(rows: Vendor[] = CAPPED_PAGE) {
  api.getVendors.mockImplementation(
    (_t: unknown, status: string, opts: { criticality?: string; reviewed?: string } = {}) => {
      if (status === "archived") return Promise.resolve(response([], 12, { low: 12 }));
      const base = opts.reviewed === "never" ? NEVER_REVIEWED : REGISTER;
      if (opts.criticality) {
        const n = base[opts.criticality as keyof typeof base];
        return Promise.resolve(response(rows, n, { [opts.criticality]: n }));
      }
      return Promise.resolve(response(rows, sum(base), base));
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
    // With ?reviewed=never active, "Critical" links to
    // ?criticality=critical&reviewed=never, so it must count THAT population.
    // Printing the register's 140 would put a number on a pill that clicking it
    // can never reproduce.
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ reviewed: "never" }),
    });

    expect(pill(container, "Critical")).toBe("Critical (55)");
    expect(pill(container, "High")).toBe("High (30)");
    expect(pill(container, "Critical")).not.toBe("Critical (140)");
  });

  it("the 'Never reviewed' pill is counted with the criticality filter applied", async () => {
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "critical" }),
    });

    // Its href is /vendors?criticality=critical&reviewed=never, so its count is
    // of that population (55) — not of every never-reviewed vendor (115).
    expect(pill(container, "Never reviewed")).toBe("Never reviewed (55)");
  });

  it("the unfiltered register shows the whole-register breakdown and total", async () => {
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(pill(container, "Never reviewed")).toBe("Never reviewed (115)");
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

  it("sends the never-reviewed filter to the engine", async () => {
    await renderPage(VendorsPage, { searchParams: sp({ reviewed: "never" }) });

    const listCall = api.getVendors.mock.calls.find(
      (c) => c[1] === "active" && c[2]?.reviewed === "never" && c[2]?.limit !== 1
    );
    expect(listCall).toBeDefined();
  });

  it("composes both axes in one engine request", async () => {
    await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "high", reviewed: "never" }),
    });

    const listCall = api.getVendors.mock.calls.find(
      (c) => c[2]?.criticality === "high" && c[2]?.reviewed === "never" && c[2]?.limit !== 1
    );
    expect(listCall).toBeDefined();
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
        pill(container, "Never reviewed"),
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
      `Never reviewed (${NEVER_REVIEWED_TOTAL})`,
      String(REGISTER_TOTAL),
    ]);
  });
});
