/**
 * /pen-tests/[id] — the engagement detail render contract (PEN-1).
 *
 * The detail is the list row plus the ORDINARY findings that reference the
 * engagement — fetched through the existing source_type/source_id filter on
 * the shared findings list, never a pentest-specific endpoint. What these
 * tests pin: the provenance fields render; each finding links to the shared
 * /findings/[id] detail; a NULL severity renders as the source's own word,
 * never a blank or an invented level; and the empty state says EXACTLY how to
 * import findings referencing this engagement, id included.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, sp, hrefOf } from "@/test/harness";
import { aFinding, aFindingsResponse, aPenTestEngagement } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getPenTestEngagement: vi.fn(),
  getFindings: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import PenTestDetailPage from "../[id]/page";

const ENGAGEMENT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const props = { params: sp({ id: ENGAGEMENT_ID }) } as never;

const penTestFinding = (over: Parameters<typeof aFinding>[0] = {}) =>
  aFinding({
    source_type: "pen_test",
    source_id: ENGAGEMENT_ID,
    ...over,
  });

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  // TWO-CONTROL MODEL: these pages are gated by ACTIVATION as well as
  // entitlement. The cases below are the render contract with the
  // capability ON; the flag-off case lives in its own describe.
  process.env["SECURELOGIC_PEN_TEST_ENABLED"] = "true";
  vi.clearAllMocks();
  signedIn();
  api.getPenTestEngagement.mockResolvedValue({ engagement: aPenTestEngagement() });
  api.getFindings.mockResolvedValue(aFindingsResponse([penTestFinding()]));
});

describe("/pen-tests/[id] — gates and not-found", () => {
  it("redirects a sub-platform caller to /dashboard", async () => {
    signedIn({ entitlementLevel: "free" });
    expect(await expectRedirect(PenTestDetailPage, props)).toBe("/dashboard");
  });

  it("redirects to the list when the engagement can't be shown (404 and cross-tenant look identical)", async () => {
    api.getPenTestEngagement.mockResolvedValue(null);
    expect(await expectRedirect(PenTestDetailPage, props)).toBe("/pen-tests");
  });
});

describe("/pen-tests/[id] — the provenance header", () => {
  it("renders the auditor's four questions: which test, by whom, when, where the report is", async () => {
    await renderPage(PenTestDetailPage, props);

    expect(screen.getByText("Q3 external network test")).toBeInTheDocument();
    expect(screen.getByText("Redwood Security")).toBeInTheDocument();
    expect(screen.getByText("Jul 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jul 12, 2026")).toBeInTheDocument();
    expect(screen.getByText("PT-2026-Q3.pdf")).toBeInTheDocument();
  });

  it("reads the findings through the shared list filter, org-token attached", async () => {
    await renderPage(PenTestDetailPage, props);

    expect(api.getFindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source_type: "pen_test", source_id: ENGAGEMENT_ID })
    );
  });
});

describe("/pen-tests/[id] — the findings it produced", () => {
  it("shows severity, status, title, and links each row to the shared finding detail", async () => {
    const { container } = await renderPage(PenTestDetailPage, props);

    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Unencrypted backups in eu-west-1")).toBeInTheDocument();
    expect(hrefOf(container, "Unencrypted backups in eu-west-1")).toBe("/findings/f-1");
  });

  it("renders a NULL severity as the source's own word, never a blank or an invented level", async () => {
    api.getFindings.mockResolvedValue(
      aFindingsResponse([
        penTestFinding({ severity: null, source_severity: "Informational" }),
      ])
    );
    await renderPage(PenTestDetailPage, props);

    expect(screen.getByText(/No severity · source: Informational/)).toBeInTheDocument();
  });
});

describe("/pen-tests/[id] — the honest empty state", () => {
  it("says exactly how to import findings referencing this engagement, id included", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse([]));
    const { container } = await renderPage(PenTestDetailPage, props);

    expect(screen.getByText(/No findings reference this engagement yet/)).toBeInTheDocument();
    // The instructions name the importer, the source type, and the id to paste.
    expect(hrefOf(container, "import findings")).toBe("/findings/import");
    expect(screen.getByText("pen_test")).toBeInTheDocument();
    expect(screen.getByText(ENGAGEMENT_ID)).toBeInTheDocument();
  });

  it("a failed findings fetch is an outage, never rendered as 'no findings'", async () => {
    api.getFindings.mockResolvedValue(null);
    await renderPage(PenTestDetailPage, props);

    expect(screen.queryByText(/No findings reference this engagement yet/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/This engagement’s findings couldn’t be loaded right now/)
    ).toBeInTheDocument();
  });
});
