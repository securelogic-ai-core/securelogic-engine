/**
 * /pen-tests — the engagement list render contract (PEN-1).
 *
 * What these tests pin: an engagement row shows the provenance an auditor asks
 * for (name, firm, period) plus its finding count — INCLUDING an explicit zero,
 * because a brand-new engagement and a failed import look identical without it;
 * the empty state says what would populate the register; and a failed fetch is
 * an outage, never rendered as an empty register.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, hrefOf } from "@/test/harness";
import { aPenTestEngagement } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getPenTestEngagements: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import PenTestsPage from "../page";

const ok = (engagements = [aPenTestEngagement()]) => ({
  engagements,
  count: engagements.length,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getPenTestEngagements.mockResolvedValue(ok());
});

describe("/pen-tests — entitlement gate", () => {
  it("redirects a signed-out caller to /login", async () => {
    signedIn({ jwtToken: undefined, apiKey: undefined });
    expect(await expectRedirect(PenTestsPage, {})).toBe("/login");
  });

  it("redirects a sub-platform caller to /dashboard", async () => {
    signedIn({ entitlementLevel: "free" });
    expect(await expectRedirect(PenTestsPage, {})).toBe("/dashboard");
  });
});

describe("/pen-tests — the engagement rows", () => {
  it("renders name, firm, period, finding count, and a link to the detail page", async () => {
    const { container } = await renderPage(PenTestsPage, {});

    expect(screen.getByText("Q3 external network test")).toBeInTheDocument();
    expect(screen.getByText("Redwood Security")).toBeInTheDocument();
    expect(screen.getByText(/Jul 1, 2026 – Jul 12, 2026/)).toBeInTheDocument();
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(hrefOf(container, "Q3 external network test")).toBe(
      "/pen-tests/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
    );
  });

  it("states a zero finding count rather than hiding it", async () => {
    api.getPenTestEngagements.mockResolvedValue(ok([aPenTestEngagement({ finding_count: 0 })]));
    await renderPage(PenTestsPage, {});

    // A brand-new engagement and a failed import look identical without this.
    expect(screen.getByText("0 findings")).toBeInTheDocument();
  });

  it("offers the two entry points of the workflow: record a test, import findings", async () => {
    const { container } = await renderPage(PenTestsPage, {});

    expect(hrefOf(container, /Record Pen Test/)).toBe("/pen-tests/new");
    expect(hrefOf(container, /Import Findings/)).toBe("/findings/import");
  });
});

describe("/pen-tests — empty and unavailable are different answers", () => {
  it("a genuinely empty register says what would populate it", async () => {
    api.getPenTestEngagements.mockResolvedValue(ok([]));
    const { container } = await renderPage(PenTestsPage, {});

    expect(screen.getByText(/No penetration tests recorded/)).toBeInTheDocument();
    expect(hrefOf(container, /Record your first pen test/)).toBe("/pen-tests/new");
  });

  it("a failed fetch renders the unavailable notice, never the empty state", async () => {
    api.getPenTestEngagements.mockResolvedValue(null);
    await renderPage(PenTestsPage, {});

    expect(screen.queryByText(/No penetration tests recorded/)).not.toBeInTheDocument();
    expect(screen.getByText(/Pen tests couldn’t be loaded right now/)).toBeInTheDocument();
    // The denial is the load-bearing sentence: the outage must not read as a
    // plan limit or an empty register.
    expect(screen.getByText(/not a limit of your plan, and not an empty register/)).toBeInTheDocument();
  });
});
