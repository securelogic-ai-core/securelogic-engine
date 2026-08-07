/**
 * /vendors — the truth contract for ordering, caps, totals, and failure.
 *
 * EDX Vendors pass #1. The engine guarantees CRITICALITY-first ordering
 * (ORDER BY criticality, created_at DESC — deterministic) and serves at most
 * 100 vendors per request with `count` = page size, never a table total; a
 * non-null nextCursor means more exist. The page previously claimed "Sorted
 * by risk level" (risk = the assessed score, which the list neither sorts by
 * nor shows), presented slice-derived counts as org totals with no cap
 * disclosure, and rendered ANY fetch failure as "not available for your
 * current plan" — an outage impersonating an entitlement denial.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
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

const okVendors = (
  vendors = [aVendor({ name: "Acme Corp", criticality: "high" })],
  nextCursor: { created_at: string; id: string } | null = null,
) => ({
  count: vendors.length,
  limit: 100,
  organizationId: "org-1",
  statusFilter: "active",
  nextCursor,
  vendors,
});

const CURSOR = { created_at: "2026-01-01T00:00:00Z", id: "v-last" };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getVendors.mockResolvedValue(okVendors());
  api.getVendorAssessments.mockResolvedValue({ assessments: [] });
});

describe("/vendors — ordering honesty", () => {
  it("states the guaranteed ordering (criticality) and never overclaims 'risk level'", async () => {
    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(text).toContain("Sorted by criticality — most critical first");
    expect(text).not.toContain("Sorted by risk level");
  });
});

describe("/vendors — count honesty at the engine cap", () => {
  it("nextCursor null → plain counts, no cap disclosure (current rendering preserved)", async () => {
    api.getVendors.mockResolvedValue(
      okVendors([
        aVendor({ id: "v-1", name: "Acme", criticality: "high" }),
        aVendor({ id: "v-2", name: "Globex", criticality: "low" }),
      ])
    );

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(text).toContain("2 active");
    expect(text).not.toContain("2+ active");
    expect(text).not.toContain("more exist");
  });

  it("nextCursor non-null → the cap is disclosed and totals stop pretending to be complete", async () => {
    const vendors = Array.from({ length: 100 }, (_, i) =>
      aVendor({ id: `v-${i}`, name: `Vendor ${i}`, criticality: "critical" })
    );
    api.getVendors.mockResolvedValue(okVendors(vendors, CURSOR));

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    // Non-technical disclosure, and the "+" that refuses exactness.
    expect(text).toContain("Showing the first 100 vendors (most critical first) — more exist.");
    expect(text).toContain("Counts on this page reflect the vendors shown");
    expect(text).toContain("100+ active");
    expect(text).not.toMatch(/(?<!\d|\+)100 active/);
  });
});

describe("/vendors — failure is never empty, denied, or zero", () => {
  it("fetch failure renders the unavailable alert with retry — not a plan denial", async () => {
    api.getVendors.mockResolvedValue(null);

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(screen.getByRole("alert").textContent).toContain("Vendors couldn’t be loaded right now");
    expect(text).toContain("not an empty list — your vendor records are unchanged");
    expect(text).toContain("Try again");
    expect(text).not.toContain("not available for your current plan");
  });

  it("fetch failure draws no empty/no-vendor conclusions", async () => {
    api.getVendors.mockResolvedValue(null);

    const { container } = await renderPage(VendorsPage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(text).not.toContain("No active vendors");
    expect(text).not.toContain("Add your first vendor");
    expect(text).not.toContain("No vendors match");
  });

  it("the retry link reproduces the current view's URL (filters preserved)", async () => {
    api.getVendors.mockResolvedValue(null);

    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ criticality: "high", q: "acme" }),
    });

    const retry = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent === "Try again"
    );
    expect(retry?.getAttribute("href")).toBe("/vendors?criticality=high&q=acme");
  });

  it("an archived-only fetch failure is disclosed instead of silently narrowing the list", async () => {
    api.getVendors.mockImplementation(async (_t: string, status: string) =>
      status === "archived" ? null : okVendors()
    );

    const { container } = await renderPage(VendorsPage, {
      searchParams: sp({ show_inactive: "1" }),
    });

    expect(container.textContent).toContain(
      "Inactive vendors couldn’t be loaded right now — the list below shows active vendors only."
    );
    // The active list still renders.
    expect(container.textContent).toContain("Acme Corp");
  });
});
