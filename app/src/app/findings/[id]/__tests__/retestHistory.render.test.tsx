/**
 * /findings/[id] — retest history render contract (T2-I).
 *
 * The verification artifact an auditor asks for — "fixed, per the retest of
 * <date>" — must be readable ON THE FINDING, newest first, each act naming
 * the engagement that performed it. In BOTH layouts (legacy and Decision
 * Workspace), beside the PEN-1 provenance, because a section added to only
 * one tree disappears the moment the flag flips.
 *
 * The absences are facts too, and they are DIFFERENT facts: an empty history
 * is "never retested"; a failed fetch is an outage; and a finding from any
 * other source has NO retest section at all — "no retests" is not a claim the
 * platform can make about a control-test finding.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp, hrefOf } from "@/test/harness";
import {
  aFinding,
  anActionsResponse,
  aFindingContext,
  aPenTestEngagement,
  aPenTestRetest,
} from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getFinding: vi.fn(),
  getActionsForFinding: vi.fn(),
  getFindingContext: vi.fn(),
  getTeamMembers: vi.fn(),
  getPenTestEngagement: vi.fn(),
  getFindingRetests: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

// The page's server actions import next/cache, which has no request scope in a
// test process. They are never invoked here — only rendered as handlers.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import FindingDetailPage from "../page";

const ENGAGEMENT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const LATER_ENGAGEMENT_ID = "cccccccc-3333-4333-8333-cccccccccccc";
const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

const penTestFinding = () =>
  aFinding({ source_type: "pen_test", source_id: ENGAGEMENT_ID });

/** Newest first, exactly as the engine returns them — including a retest by a
 *  LATER engagement than the one that produced the finding. */
const twoRetests = () => ({
  count: 2,
  retests: [
    aPenTestRetest({
      id: "r-2",
      engagement_id: LATER_ENGAGEMENT_ID,
      engagement_name: "Q1 2027 annual verification",
      result: "not_remediated",
      notes: "Host still reachable on the vulnerable port.",
      performed_on: "2026-08-15",
    }),
    aPenTestRetest({ id: "r-1", performed_on: "2026-08-01" }),
  ],
});

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  // The retest section is behind the pen-test ACTIVATION flag as well as the
  // source-type check: this page is not otherwise pen-test gated, so a dark
  // capability must not surface anything here. These cases describe the
  // capability when it is ON; the dark case is its own describe below.
  process.env["SECURELOGIC_PEN_TEST_ENABLED"] = "true";
  api.getFinding.mockResolvedValue({ finding: penTestFinding() });
  api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));
  api.getFindingContext.mockResolvedValue(null);
  api.getTeamMembers.mockResolvedValue({ members: [], pending_invites: [], seat_usage: { used: 0, max: 5 } });
  api.getPenTestEngagement.mockResolvedValue({ engagement: aPenTestEngagement() });
  api.getFindingRetests.mockResolvedValue(twoRetests());
});

describe("legacy layout — the retest history section", () => {
  it("renders each retest act: engagement name (linked), result, notes, date — newest first", async () => {
    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Retest History")).toBeInTheDocument();

    // The newest act — performed by a LATER engagement than the one that
    // produced the finding (the annual test verifying last year's fixes).
    expect(screen.getByText("Not Remediated")).toBeInTheDocument();
    expect(screen.getByText("Host still reachable on the vulnerable port.")).toBeInTheDocument();
    expect(screen.getByText("Aug 15, 2026")).toBeInTheDocument();
    expect(hrefOf(container, "Q1 2027 annual verification")).toBe(
      `/pen-tests/${LATER_ENGAGEMENT_ID}`
    );

    // The earlier act.
    expect(screen.getByText("Remediated")).toBeInTheDocument();
    expect(screen.getByText("Aug 1, 2026")).toBeInTheDocument();

    // Rendered in the order the engine returned — newest first.
    const badges = Array.from(container.querySelectorAll("span")).map(
      (s) => s.textContent
    );
    expect(badges.indexOf("Not Remediated")).toBeLessThan(badges.indexOf("Remediated"));

    // The ruling, stated where the reader stands: a retest never closes.
    expect(screen.getByText(/A retest verifies; it never closes/)).toBeInTheDocument();
    expect(api.getFindingRetests).toHaveBeenCalledWith(expect.anything(), "f-1");
  });

  it("an empty history is the FACT 'never retested', not a hidden section", async () => {
    api.getFindingRetests.mockResolvedValue({ count: 0, retests: [] });
    await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Retest History")).toBeInTheDocument();
    expect(screen.getByText(/Never retested/)).toBeInTheDocument();
  });

  it("a failed fetch is an outage — never rendered as 'never retested'", async () => {
    api.getFindingRetests.mockResolvedValue(null);
    await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Retest History")).toBeInTheDocument();
    expect(screen.queryByText(/Never retested/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Retest history couldn’t be loaded right now/)
    ).toBeInTheDocument();
  });

  it("a finding from any other source has NO retest section — and no retest fetch at all", async () => {
    api.getFinding.mockResolvedValue({ finding: aFinding() }); // source_type: manual
    await renderPage(FindingDetailPage, props());

    expect(screen.queryByText("Retest History")).not.toBeInTheDocument();
    expect(api.getFindingRetests).not.toHaveBeenCalled();
  });
});

describe("Decision Workspace layout — the history survives the flag flip", () => {
  it("renders the same retest section beside the PEN-1 provenance", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    api.getFindingContext.mockResolvedValue(aFindingContext());

    const { container } = await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Retest History")).toBeInTheDocument();
    expect(screen.getByText("Not Remediated")).toBeInTheDocument();
    expect(hrefOf(container, "Q1 2027 annual verification")).toBe(
      `/pen-tests/${LATER_ENGAGEMENT_ID}`
    );
  });

  it("keeps the section absent for non-pen-test findings in the workspace too", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    api.getFindingContext.mockResolvedValue(aFindingContext());
    api.getFinding.mockResolvedValue({ finding: aFinding() });

    await renderPage(FindingDetailPage, props());

    expect(screen.queryByText("Retest History")).not.toBeInTheDocument();
    expect(api.getFindingRetests).not.toHaveBeenCalled();
  });
});

// ─── The activation flag reaches this page too (NAV/T2-I reconciliation) ─────
//
// /findings/[id] is NOT pen-test gated — any platform user reaches it for any
// finding. #868 hung retest history off it, which created a leak the pen-test
// pages themselves cannot have: with the capability dark the engine 404s
// /api/findings/:id/retests, `getFindingRetests` resolves null, and null is
// rendered by RetestHistorySection as "Retest history couldn't be loaded right
// now — an outage, not an empty history".
//
// So turning the capability OFF would have made every pen_test finding announce
// an OUTAGE about a capability that is deliberately off — a false alarm, on a
// page nobody gated, aimed at the one word ("outage") a customer escalates.
// Dark means ABSENT, exactly as it already is for a control_test finding.
describe("FLAG FALSE — the retest section is absent, not an outage notice", () => {
  beforeEach(() => {
    delete process.env["SECURELOGIC_PEN_TEST_ENABLED"];
  });

  it("renders no retest section at all for a pen_test finding", async () => {
    await renderPage(FindingDetailPage, props());
    expect(screen.queryByText("Retest History")).not.toBeInTheDocument();
  });

  it("never claims an outage while the capability is merely off", async () => {
    await renderPage(FindingDetailPage, props());
    expect(screen.queryByText(/couldn’t be loaded right now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/outage/i)).not.toBeInTheDocument();
  });

  it("does not claim 'never retested' either — silence, not a false fact", async () => {
    // The opposite failure mode. We cannot know the history while dark, so the
    // page must assert nothing about it in either direction.
    await renderPage(FindingDetailPage, props());
    expect(screen.queryByText(/never retested/i)).not.toBeInTheDocument();
  });

  it("spends NO retest fetch when dark — the gate precedes the load", async () => {
    await renderPage(FindingDetailPage, props());
    expect(api.getFindingRetests).not.toHaveBeenCalled();
  });

  it("leaves PEN-1 provenance exactly as develop already ships it", async () => {
    // Deliberately NOT gated by this package: the engagement arm degrades to the
    // plain source label on its own and that behaviour is already shipped and
    // validated. Changing it here would be scope the reconciliation has no
    // mandate for — so it must still be fetched.
    await renderPage(FindingDetailPage, props());
    expect(api.getPenTestEngagement).toHaveBeenCalled();
  });

  it("the rest of the finding page is unaffected", async () => {
    const { container } = await renderPage(FindingDetailPage, props());
    expect(container.textContent).toBeTruthy();
    expect(screen.queryByText("Retest History")).not.toBeInTheDocument();
  });
});
