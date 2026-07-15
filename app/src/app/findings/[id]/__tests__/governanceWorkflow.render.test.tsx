/**
 * /findings/[id] — the Risk-Acceptance governance surface (P0 + P1, 2026-07-15).
 *
 * These assert the two things the staging walkthrough proved were missing:
 *
 *   P0 — the one-click "Accept Risk" side door is gated by the FEATURE FLAG, not by whether
 *        acceptance data happened to load. With the workflow on, the button is gone even
 *        when the fetch returns null (a transient failure) — and an explicit "unavailable"
 *        notice appears instead, never a silent fall-back to the ungoverned label. With the
 *        workflow off (production), the legacy one-click control is unchanged.
 *
 *   P1 — a LIVE acceptance announces its governance state at the TOP of the page (the
 *        GovernanceBanner), so a user never infers "proposed vs approved vs a label" from
 *        the Decision dropdown value.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { aFinding, anActionsResponse, aFindingContext, aRiskAcceptance } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getFinding: vi.fn(),
  getActionsForFinding: vi.fn(),
  getFindingContext: vi.fn(),
  getTeamMembers: vi.fn(),
  getFindingEvidence: vi.fn(),
  getRiskAcceptancesForFinding: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import FindingDetailPage from "../page";

const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

/** Decision Workspace on: both switches (app flag + engine context), as production requires. */
function workspaceOn() {
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
  api.getFindingContext.mockResolvedValue(aFindingContext());
}

const acceptButton = () => screen.queryByRole("button", { name: "Accept Risk" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  signedIn({ userId: "user-1" });
  api.getFinding.mockResolvedValue({ finding: aFinding() });
  api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));
  api.getFindingContext.mockResolvedValue(null);
  api.getTeamMembers.mockResolvedValue({
    members: [
      { id: "user-1", email: "ana@example.com", name: "Ana Ops", role: "member", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null },
      { id: "user-2", email: "boss@example.com", name: "Bo Boss", role: "admin", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null },
    ],
    pending_invites: [],
    seat_usage: { used: 2, max: 5 },
  });
  api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [] });
  api.getRiskAcceptancesForFinding.mockResolvedValue(null);
});

describe("P0 — the one-click Accept Risk side door", () => {
  it("is OFFERED when the workflow is OFF (production posture)", async () => {
    workspaceOn();
    // SECURELOGIC_RISK_ACCEPTANCE_ENABLED unset → feature off → legacy one-click stays.
    await renderPage(FindingDetailPage, props());
    expect(acceptButton()).not.toBeNull();
    // The page must not even consult the acceptance route when the feature is off.
    expect(api.getRiskAcceptancesForFinding).not.toHaveBeenCalled();
  });

  it("is REMOVED when the workflow is ON, even with no acceptances yet", async () => {
    workspaceOn();
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
    api.getRiskAcceptancesForFinding.mockResolvedValue([]);
    await renderPage(FindingDetailPage, props());
    expect(acceptButton()).toBeNull();
  });

  it("does NOT silently reappear when the workflow is ON but the fetch fails (null)", async () => {
    workspaceOn();
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
    api.getRiskAcceptancesForFinding.mockResolvedValue(null); // transient failure
    await renderPage(FindingDetailPage, props());

    // The side door stays shut...
    expect(acceptButton()).toBeNull();
    // ...and the user is told why, rather than shown an ungoverned control.
    expect(screen.getByText(/temporarily unavailable/i)).toBeTruthy();
  });
});

describe("P1 — the governance banner announces live acceptance state", () => {
  it("a PROPOSED acceptance shows 'Pending Approval', the requester, and the next action", async () => {
    workspaceOn();
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
    api.getRiskAcceptancesForFinding.mockResolvedValue([
      aRiskAcceptance({
        state: "proposed",
        requested_by_user_id: "user-1",
        requested_by_name: "Ana Ops",
        is_self_proposed: true,
      }),
    ]);
    await renderPage(FindingDetailPage, props());

    // Banner heading is unique to the banner; the requester + next-action text legitimately
    // appear in BOTH the banner and the panel below, so assert "at least one".
    expect(screen.getByText(/Pending Approval/i)).toBeTruthy();
    expect(screen.getAllByText(/Ana Ops/).length).toBeGreaterThan(0);
    // The next required action is STATED (viewer proposed it → cannot self-approve).
    expect(screen.getAllByText(/different authorized user must approve/i).length).toBeGreaterThan(0);
    // And the one-click door is not present.
    expect(acceptButton()).toBeNull();
  });

  it("an APPROVED acceptance shows 'Governed' and the review date", async () => {
    workspaceOn();
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
    api.getRiskAcceptancesForFinding.mockResolvedValue([
      aRiskAcceptance({
        state: "approved",
        approver_user_id: "user-2",
        approver_name: "Bo Boss",
        approved_at: "2026-07-12T00:00:00.000Z",
        expires_at: "2026-12-31",
      }),
    ]);
    await renderPage(FindingDetailPage, props());

    // "Governed" and the review date appear in both the banner and the panel.
    expect(screen.getAllByText(/Governed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026-12-31/).length).toBeGreaterThan(0);
  });

  it("shows NO banner when there is no live acceptance (feature on, empty history)", async () => {
    workspaceOn();
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
    api.getRiskAcceptancesForFinding.mockResolvedValue([]);
    await renderPage(FindingDetailPage, props());

    expect(screen.queryByText(/Pending Approval/i)).toBeNull();
    expect(screen.queryByText(/Risk Accepted — Governed/i)).toBeNull();
  });
});
