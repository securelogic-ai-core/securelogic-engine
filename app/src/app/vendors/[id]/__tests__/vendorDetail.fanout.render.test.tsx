/**
 * /vendors/[id] — request fan-out and the recoverable "engine did not answer"
 * state.
 *
 * Measured on staging 2026-09-04: one render of this page cost 18 engine
 * calls — 2 for the session bridge, 8 page reads, 1 assurance-docs read, and
 * `GET /frameworks` + one `GET /frameworks/:id/requirements` PER activated
 * framework (7 with six frameworks). The default limiter is 120/min keyed on
 * the caller's JWT, so an analyst working relationship → contact → intake at
 * ordinary speed (a render per server action, via router.refresh) reached 429,
 * and the page then redirected to /vendors as if the vendor were gone.
 *
 * These tests pin the correction: the per-framework loop is ONE aggregate read
 * whatever the framework count, the page's engine budget is bounded, a
 * realistic minute of use stays under the limiter, and a 429/5xx/timeout on
 * the vendor read is a recoverable state on THIS page, not a redirect.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, sp } from "@/test/harness";
import { aVendor, aVendorAssessmentsResponse, aVendorReviewsResponse } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getVendor: vi.fn(),
  getVendorDetail: vi.fn(),
  getVendorAssessmentsForVendor: vi.fn(),
  getVendorReviews: vi.fn(),
  getVendorFindings: vi.fn(),
  getVendorSignals: vi.fn(),
  getVendorAiDependencies: vi.fn(),
  listVendorContacts: vi.fn(),
  listVendorRelationships: vi.fn(),
  listVendorAssuranceDocuments: vi.fn(),
  getVendorAssuranceExtraction: vi.fn(),
  getVendorFrameworkProgress: vi.fn(),
  // The two readers the aggregate replaced. Mocked so a regression that
  // reintroduces them is COUNTED, not silently hitting the network.
  getFrameworks: vi.fn(),
  getFrameworkRequirements: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import VendorDetailPage from "../page";

const props = (id = "v-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

/** Engine calls this PAGE makes per render (mocked readers = engine reads). */
function pageEngineCalls(): number {
  return Object.values(api).reduce((n, fn) => n + fn.mock.calls.length, 0);
}

const SIX_FRAMEWORKS = Array.from({ length: 6 }, (_, i) => ({
  framework: { id: `fw-${i}`, name: `Framework ${i}`, version: "1.0" },
  summary: { total: 10, pass: 3, partial: 1, fail: 1, not_assessed: 5, progress_pct: 50, last_response_at: null },
}));

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getVendorDetail.mockResolvedValue({ outcome: "ok", vendor: aVendor() });
  api.getVendorAssessmentsForVendor.mockResolvedValue(aVendorAssessmentsResponse([]));
  api.getVendorReviews.mockResolvedValue(aVendorReviewsResponse([]));
  api.getVendorFindings.mockResolvedValue({ findings: [], total: 0 });
  api.getVendorSignals.mockResolvedValue([]);
  api.getVendorAiDependencies.mockResolvedValue([]);
  api.listVendorContacts.mockResolvedValue({ contacts: [] });
  api.listVendorRelationships.mockResolvedValue({ relationships: [] });
  api.listVendorAssuranceDocuments.mockResolvedValue({ documents: [] });
  api.getVendorAssuranceExtraction.mockResolvedValue(null);
  api.getVendorFrameworkProgress.mockResolvedValue({ vendor_id: "v-1", frameworks: SIX_FRAMEWORKS });
});

// ─────────────────────────────────────────────────────────────────────
// 1. The per-framework loop is gone
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — framework progress is ONE read", () => {
  it("with six started frameworks: one aggregate call, zero per-framework requirement reads", async () => {
    await renderPage(VendorDetailPage, props());
    expect(api.getVendorFrameworkProgress).toHaveBeenCalledTimes(1);
    expect(api.getVendorFrameworkProgress).toHaveBeenCalledWith("test-jwt", "v-1");
    expect(api.getFrameworks).not.toHaveBeenCalled();
    expect(api.getFrameworkRequirements).not.toHaveBeenCalled();
    // …and the six rows render from that one read.
    for (let i = 0; i < 6; i++) expect(screen.getByText(`Framework ${i}`)).toBeInTheDocument();
  });

  it("a framework the aggregate returns with nothing assessed is not shown (defensive; the engine already filters)", async () => {
    api.getVendorFrameworkProgress.mockResolvedValue({
      vendor_id: "v-1",
      frameworks: [{ framework: { id: "fw-x", name: "Untouched", version: "1.0" }, summary: { total: 4, pass: 0, partial: 0, fail: 0, not_assessed: 4, progress_pct: 0, last_response_at: null } }],
    });
    await renderPage(VendorDetailPage, props());
    expect(screen.queryByText("Untouched")).not.toBeInTheDocument();
  });

  it("a FAILED aggregate read renders no progress rows — never a fabricated 'nothing started'", async () => {
    api.getVendorFrameworkProgress.mockResolvedValue(null);
    await renderPage(VendorDetailPage, props());
    expect(screen.queryByText(/Framework \d/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. The engine budget of a render, and of a realistic minute
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — engine budget", () => {
  // Engine-side facts this budget is checked against (src/api/routes/index.ts:
  // createApiKeyRateLimiter(120) on all of /api, keyed per bearer = per user
  // session). Kept literal so a limiter change is a visible test change.
  const LIMIT_PER_MINUTE = 120;
  // Calls the app makes per render that are NOT this page's readers: the
  // session bridge (/auth/me, /me) — measured on staging.
  const SESSION_BRIDGE_CALLS = 2;
  // The client-side history fetch the page issues after hydration (measured).
  const CLIENT_SIDE_CALLS = 1;
  // A realistic worst minute of the onboarding workflow: create vendor (1
  // render), add relationship, add contact, record intake (each = 1 action +
  // 1 refresh render), one manual reload — 5 renders + 3 actions.
  const RENDERS_PER_MINUTE = 5;
  const ACTIONS_PER_MINUTE = 3;

  it("one render, no reviewed assurance document: at most 10 page reads, framework count irrelevant", async () => {
    await renderPage(VendorDetailPage, props());
    expect(pageEngineCalls()).toBeLessThanOrEqual(10);
  });

  it("a realistic minute of the onboarding workflow stays under the per-session limiter", async () => {
    await renderPage(VendorDetailPage, props());
    const perRender = pageEngineCalls() + SESSION_BRIDGE_CALLS + CLIENT_SIDE_CALLS;
    const minute = RENDERS_PER_MINUTE * perRender + ACTIONS_PER_MINUTE;
    expect(minute).toBeLessThan(LIMIT_PER_MINUTE);
    // Before the aggregate, the same minute with six frameworks was
    // 5 × (18 + 1) + 3 = 98 engine calls *from this page alone*, before the
    // /vendors/new render and the list page that share the window — over.
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. "The engine did not answer" is a state on THIS page
// ─────────────────────────────────────────────────────────────────────

describe("/vendors/[id] — when the vendor read is refused or fails", () => {
  it("unavailable (429 / 5xx / timeout): stays on the page, names the subject, denies the false readings, offers a retry — no redirect", async () => {
    api.getVendorDetail.mockResolvedValue({ outcome: "unavailable", vendor: null });
    await renderPage(VendorDetailPage, props("v-1"));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This vendor couldn’t be loaded right now");
    expect(alert.textContent).toContain("not a missing vendor");
    expect(alert.textContent).toContain("not a limit of your plan");
    expect(screen.getByRole("link", { name: /try again/i }).getAttribute("href")).toBe("/vendors/v-1");
  });

  it("not found / not this caller's record: the redirect contract is unchanged", async () => {
    api.getVendorDetail.mockResolvedValue({ outcome: "not_found", vendor: null });
    expect(await expectRedirect(VendorDetailPage, props("v-other-org"))).toBe("/vendors");
  });
});
