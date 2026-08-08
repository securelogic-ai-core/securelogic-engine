/**
 * EDX-1 cross-surface outage contract.
 *
 * These six list surfaces shared ONE customer-visible falsehood: when their
 * fetch failed they rendered "<X> data is not available for your current
 * plan." — attributing an engine outage to the customer's subscription. Every
 * lib/api reader collapses a 500, a timeout, a dropped connection and a 403
 * into the same `null`, so the page could not possibly know that, and four of
 * the six had already redirected non-platform callers before the branch could
 * run. A paying Platform customer was told they had not paid for a feature
 * they had.
 *
 * The invariant is cross-surface, so the test is too: this file exists next to
 * the surfaces rather than inside any one of them, because what it defends is
 * the PATTERN — no read surface may present a failed fetch as a statement
 * about the customer's plan or as an empty register.
 *
 * Verified against pre-migration code: 26 of these 35 cases fail on it. The 9
 * that pass are regression guards, not new ground — the six "does not render an
 * empty state" checks (the old branch rendered its plan notice instead of the
 * empty state, so it never had this bug) and the three successful-empty cases
 * (behaviour that was already right and must survive the migration).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn } from "@/test/harness";

const api = vi.hoisted(() => ({
  getVendors: vi.fn(),
  getVendorAssessments: vi.fn(),
  getAiSystems: vi.fn(),
  getGovernanceReviews: vi.fn(),
  getControls: vi.fn(),
  getControlAssessments: vi.fn(),
  getObligations: vi.fn(),
  getObligationSummary: vi.fn(),
  getPolicies: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import VendorsPage from "../vendors/page";
import VendorRiskPage from "../vendors/risk/page";
import AiSystemsPage from "../ai-systems/page";
import ControlsPage from "../controls/page";
import ObligationsPage from "../obligations/page";
import PoliciesPage from "../policies/page";

const noParams = { searchParams: Promise.resolve({}) };

/** The six consumers, each rendered with EVERY fetch failed (the outage case). */
const SURFACES: Array<{
  name: string;
  subject: RegExp;
  /** The reading the surface's data genuinely rules out. */
  denial: RegExp;
  render: () => Promise<unknown>;
  /** Retry destination, or null where the surface offers none. */
  retry: string | null;
}> = [
  {
    name: "/vendors",
    subject: /Vendors couldn’t be loaded right now/,
    denial: /not a limit of your plan/,
    render: () => renderPage(VendorsPage, noParams),
    retry: "/vendors",
  },
  {
    name: "/vendors/risk",
    subject: /Vendor risk couldn’t be loaded right now/,
    denial: /not a limit of your plan/,
    render: () => renderPage(VendorRiskPage, undefined as never),
    retry: "/vendors/risk",
  },
  {
    name: "/ai-systems",
    subject: /AI systems couldn’t be loaded right now/,
    denial: /not an empty register/,
    render: () => renderPage(AiSystemsPage, noParams),
    retry: "/ai-systems",
  },
  {
    name: "/controls",
    subject: /Controls couldn’t be loaded right now/,
    denial: /not an empty library/,
    render: () => renderPage(ControlsPage, noParams),
    retry: "/controls",
  },
  {
    name: "/obligations",
    subject: /Obligations couldn’t be loaded right now/,
    denial: /not a limit of your plan/,
    render: () => renderPage(ObligationsPage, noParams),
    retry: "/obligations",
  },
  {
    name: "/policies",
    subject: /Policies couldn’t be loaded right now/,
    denial: /not an empty library/,
    render: () => renderPage(PoliciesPage, undefined as never),
    retry: "/policies",
  },
];

/** Every reader fails — the outage the six surfaces used to misreport. */
function allFetchesFail(): void {
  for (const fn of Object.values(api)) fn.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn({ entitlementLevel: "platform" });
  allFetchesFail();
});

describe("EDX-1 — an outage is never presented as a plan limitation", () => {
  for (const s of SURFACES) {
    describe(s.name, () => {
      it("does not blame the customer's plan", async () => {
        await s.render();
        expect(document.body.textContent).not.toMatch(/not available for your current plan/i);
        expect(document.body.textContent).not.toMatch(/upgrade/i);
      });

      it("names the subject and announces the failure assertively", async () => {
        await s.render();
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toMatch(s.subject);
      });

      it("denies the false reading the data actually rules out", async () => {
        await s.render();
        expect(screen.getByRole("alert").textContent).toMatch(s.denial);
      });

      it("offers a retry that lands back on this surface", async () => {
        await s.render();
        const link = screen.getByRole("link", { name: /try again/i });
        expect(link.getAttribute("href")).toBe(s.retry);
      });

      it("does not render an empty state — an outage is not an answer", async () => {
        await s.render();
        expect(document.body.textContent).not.toMatch(
          /no (vendors|ai systems|controls|obligations|policies) (registered|defined|yet)/i,
        );
        expect(document.body.textContent).not.toMatch(/add your first/i);
      });
    });
  }
});

describe("EDX-1 — a successful empty response still gets the ordinary empty state", () => {
  it("/vendors: zero vendors is an ANSWER, not an outage", async () => {
    api.getVendors.mockResolvedValue({ vendors: [] });
    api.getVendorAssessments.mockResolvedValue({ assessments: [] });
    await renderPage(VendorsPage, noParams);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/couldn’t be loaded/);
  });

  it("/policies: zero policies is an ANSWER, not an outage", async () => {
    api.getPolicies.mockResolvedValue({ policies: [] });
    await renderPage(PoliciesPage, undefined as never);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toMatch(/No policies defined yet/);
  });

  it("/controls: zero controls is an ANSWER, not an outage", async () => {
    api.getControls.mockResolvedValue({ controls: [] });
    api.getControlAssessments.mockResolvedValue({ assessments: [] });
    await renderPage(ControlsPage, noParams);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("EDX-1 — recovery preserves the customer's context", () => {
  it("/controls: a retry keeps the filter and search the customer was using", async () => {
    await renderPage(ControlsPage, {
      searchParams: Promise.resolve({ filter: "overdue", q: "encryption" }),
    });
    const link = screen.getByRole("link", { name: /try again/i });
    expect(link.getAttribute("href")).toBe("/controls?filter=overdue&q=encryption");
  });

  it("/ai-systems: a retry keeps the search term", async () => {
    await renderPage(AiSystemsPage, { searchParams: Promise.resolve({ q: "copilot" }) });
    const link = screen.getByRole("link", { name: /try again/i });
    expect(link.getAttribute("href")).toBe("/ai-systems?q=copilot");
  });
});
