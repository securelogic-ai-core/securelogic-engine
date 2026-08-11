/**
 * /vendors — the shared-search render contract.
 *
 * The Vendors list adopts the platform SEARCH pattern: a SEARCH label + input
 * + button, submitted as a URL param resolved by the shared asset-search
 * capability (name, product alias, exact UUID). These tests pin the
 * cross-page consistency contract: same bounds guard, filter preservation in
 * BOTH directions (search keeps pills, pills keep search), honest empty state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp, hrefOf } from "@/test/harness";
import { aVendor } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getVendors: vi.fn(),
  getVendorAssessments: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import VendorsPage from "../page";

const okVendors = (vendors = [aVendor({ name: "Search Vendor", criticality: "high" })]) => ({
  count: vendors.length,
  limit: 100,
  organizationId: "org-1",
  statusFilter: "active",
  nextCursor: null,
  vendors,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getVendors.mockResolvedValue(okVendors());
  api.getVendorAssessments.mockResolvedValue({ assessments: [] });
});

describe("/vendors — the search section", () => {
  it("renders the SEARCH label, input, and button (the platform list-page pattern)", async () => {
    await renderPage(VendorsPage, { searchParams: sp({}) });

    expect(screen.getByText("Search", { selector: "label" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Name, vendor ID, product alias...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("an active search is passed to the engine read (both status populations)", async () => {
    await renderPage(VendorsPage, {
      searchParams: sp({ q: "SrchSuite", show_inactive: "1" }),
    });

    expect(api.getVendors).toHaveBeenCalledWith(expect.anything(), "active", { q: "SrchSuite" });
    expect(api.getVendors).toHaveBeenCalledWith(expect.anything(), "archived", { q: "SrchSuite" });
  });

  it("blank and out-of-bounds terms are not sent (platform 2–120 guard)", async () => {
    for (const bad of ["   ", "a", "a".repeat(121)]) {
      vi.clearAllMocks();
      signedIn();
      api.getVendors.mockResolvedValue(okVendors());
      api.getVendorAssessments.mockResolvedValue({ assessments: [] });
      await renderPage(VendorsPage, { searchParams: sp({ q: bad }) });
      expect(api.getVendors).toHaveBeenCalledWith(expect.anything(), "active", { q: undefined });
    }
  });

  it("the form carries the active filters; the pills preserve the search", async () => {
    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "high", q: "SrchSuite" }),
    });

    const form = container.querySelector("form[action='/vendors']") as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.querySelector("input[name='criticality'][value='high']")).not.toBeNull();

    // A pill click must not silently drop the active search…
    expect(hrefOf(container, /^All$/)).toBe("/vendors?q=SrchSuite");
    expect(hrefOf(container, /^Critical/)).toContain("q=SrchSuite");
    // …and neither may the inactive toggle.
    expect(hrefOf(container, /Show inactive/)).toContain("q=SrchSuite");
  });

  it("an empty search result says so with a clear-search route — never 'add your first vendor'", async () => {
    api.getVendors.mockResolvedValue(okVendors([]));

    const { container } = await renderPage(VendorsPage, { searchParams: sp({ q: "nomatch" }) });

    expect(screen.getByText(/No vendors match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/Add your first vendor/)).not.toBeInTheDocument();
    expect(hrefOf(container, /Clear search/)).toBe("/vendors");
  });
});
