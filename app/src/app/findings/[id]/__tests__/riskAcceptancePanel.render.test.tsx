/**
 * Risk-acceptance lifecycle — what the CUSTOMER sees and can do, in the Decision Workspace.
 *
 * The pure state machine is proven in riskAcceptanceView.test.ts. This suite proves the
 * PAGE wires it honestly:
 *   - flag OFF keeps the legacy one-click Accept Risk (byte-identical);
 *   - flag ON replaces it with the signed lifecycle and removes accepted_risk from the
 *     decision dropdown (the panel owns it);
 *   - a proposal stays Active and offers approve/reject to a DIFFERENT user only
 *     (separation of duties refuses the proposer in the UI, before the round-trip);
 *   - approve / reject / withdraw drive the engine actions with the right ids;
 *   - approved reads as binding+closed+governed; legacy reads as withdraw-to-complete;
 *   - terminal records render as history.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { aFinding, anActionsResponse, aFindingContext, aRiskAcceptance } from "@/test/fixtures";
import type { RiskAcceptance } from "@/lib/api";

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

// The lifecycle server actions are rendered as handlers and invoked on click. Mock them
// so a click asserts intent (the right id, the right verb) without a real fetch/session.
const actions = vi.hoisted(() => ({
  proposeRiskAcceptanceAction: vi.fn(async () => ({})),
  approveRiskAcceptanceAction: vi.fn(async () => ({})),
  rejectRiskAcceptanceAction: vi.fn(async () => ({})),
  withdrawRiskAcceptanceAction: vi.fn(async () => ({})),
  attachRiskAcceptanceEvidenceAction: vi.fn(async () => ({})),
}));
vi.mock("../riskAcceptanceActions", () => actions);

import FindingDetailPage from "../page";

const props = (id = "f-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

/** Workspace on (both switches) AND the risk-acceptance feature active with these rows. */
function raOn(acceptances: RiskAcceptance[]) {
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
  vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
  api.getFindingContext.mockResolvedValue(aFindingContext());
  api.getRiskAcceptancesForFinding.mockResolvedValue(acceptances);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn({ userId: "user-2" }); // the viewer; NOT the proposer in the fixtures
  api.getFinding.mockResolvedValue({ finding: aFinding() });
  api.getActionsForFinding.mockResolvedValue(anActionsResponse([]));
  api.getFindingContext.mockResolvedValue(null);
  api.getRiskAcceptancesForFinding.mockResolvedValue(null);
  api.getTeamMembers.mockResolvedValue({
    members: [
      { id: "user-1", email: "pat@ex.com", name: "Pat Proposer", role: "member", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null },
      { id: "user-2", email: "avery@ex.com", name: "Avery Approver", role: "member", status: "active", created_at: "2026-01-01T00:00:00.000Z", last_used_at: null },
    ],
    pending_invites: [],
    seat_usage: { used: 2, max: 5 },
  });
  api.getFindingEvidence.mockResolvedValue({ ok: true, evidence: [] });
});

// ── flag OFF: legacy control, no panel ───────────────────────────────────────
describe("risk acceptance — dark", () => {
  it("with the feature off (null acceptances) the legacy Accept Risk button stays and no panel renders", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "false");
    api.getFindingContext.mockResolvedValue(aFindingContext());
    // page won't call it (flag off), but be explicit:
    api.getRiskAcceptancesForFinding.mockResolvedValue(null);

    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("button", { name: "Accept Risk" })).toBeInTheDocument();
    expect(screen.queryByText("Risk acceptance")).toBeNull();
    expect(api.getRiskAcceptancesForFinding).not.toHaveBeenCalled();
  });

  it("with the app flag ON, a null result (transient failure) does NOT resurrect the legacy control (P0)", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_RISK_ACCEPTANCE_ENABLED", "true");
    api.getFindingContext.mockResolvedValue(aFindingContext());
    api.getRiskAcceptancesForFinding.mockResolvedValue(null);

    await renderPage(FindingDetailPage, props());

    // P0 (2026-07-15): the side door is gated by the FLAG, not by whether data loaded. A
    // null fetch with the workflow on is a transient failure — the one-click control stays
    // gone, and the user is told the workflow is unavailable rather than handed an
    // ungoverned shortcut.
    expect(screen.queryByRole("button", { name: "Accept Risk" })).toBeNull();
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });
});

// ── flag ON, no acceptance yet: propose replaces the legacy control ───────────
describe("risk acceptance — active, no live acceptance", () => {
  it("replaces the legacy Accept Risk with a Propose affordance and drops accepted_risk from the dropdown", async () => {
    raOn([]);

    const { container } = await renderPage(FindingDetailPage, props());

    // The panel is present; the legacy one-click Accept Risk is gone.
    expect(screen.getByText("Risk acceptance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propose risk acceptance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept Risk" })).toBeNull();

    // The decision dropdown no longer offers accepted_risk — the panel owns it now.
    const options = Array.from(container.querySelectorAll("option")).map((o) => (o.textContent ?? "").trim());
    expect(options).not.toContain("Accepted Risk");
  });

  it("opening Propose reveals owner/rationale/date and submits with the captured values", async () => {
    raOn([]);
    await renderPage(FindingDetailPage, props());

    fireEvent.click(screen.getByRole("button", { name: "Propose risk acceptance" }));

    fireEvent.change(screen.getByLabelText("Accountable owner"), { target: { value: "user-1" } });
    fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "Compensating control in place." } });
    fireEvent.change(screen.getByLabelText("Review or expiration date"), { target: { value: "2026-12-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Propose acceptance" }));

    expect(actions.proposeRiskAcceptanceAction).toHaveBeenCalledWith("f-1", {
      owner_user_id: "user-1",
      rationale: "Compensating control in place.",
      expires_at: "2026-12-31",
    });
  });
});

// ── flag ON, proposed: separation of duties ──────────────────────────────────
describe("risk acceptance — a proposal awaiting approval", () => {
  it("a DIFFERENT authorized user can approve; the finding is described as still Active", async () => {
    raOn([aRiskAcceptance({ id: "ra-9", state: "proposed", requested_by_user_id: "user-1" })]);
    signedIn({ userId: "user-2" });

    await renderPage(FindingDetailPage, props());

    const panel = screen.getByText("Risk acceptance").closest("div") as HTMLElement;
    expect(within(panel.parentElement as HTMLElement).getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByText(/stays Active until a different authorized user approves/i)).toBeInTheDocument();

    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).not.toBeDisabled();

    fireEvent.click(approve);
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(actions.approveRiskAcceptanceAction).toHaveBeenCalledWith("f-1", "ra-9", { decision_rationale: undefined });
  });

  it("the PROPOSER cannot approve or reject their own acceptance — the control refuses (SoD)", async () => {
    raOn([aRiskAcceptance({ id: "ra-9", state: "proposed", requested_by_user_id: "user-2" })]);
    signedIn({ userId: "user-2" }); // the proposer is viewing

    await renderPage(FindingDetailPage, props());

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByText(/You proposed this acceptance/i)).toBeInTheDocument();
    // …but they may still withdraw their own proposal.
    expect(screen.getByRole("button", { name: "Withdraw" })).not.toBeDisabled();
  });

  it("rejecting drives the reject action with the acceptance id", async () => {
    raOn([aRiskAcceptance({ id: "ra-9", state: "proposed", requested_by_user_id: "user-1" })]);
    signedIn({ userId: "user-2" });

    await renderPage(FindingDetailPage, props());
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(actions.rejectRiskAcceptanceAction).toHaveBeenCalledWith("f-1", "ra-9", { decision_rationale: undefined });
  });
});

// ── flag ON, approved / legacy / history ─────────────────────────────────────
describe("risk acceptance — approved, legacy, and history", () => {
  it("an approved acceptance reads as binding + closed + governed, and offers withdrawal", async () => {
    raOn([
      aRiskAcceptance({
        id: "ra-appr",
        state: "approved",
        requested_by_user_id: "user-1",
        approver_user_id: "user-2",
        approved_at: "2026-07-11T00:00:00Z",
        expires_at: "2027-01-01",
      }),
    ]);

    await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Accepted — binding")).toBeInTheDocument();
    expect(screen.getByText(/closed and has left Active Findings/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw acceptance" })).toBeInTheDocument();
    // An approved acceptance is not re-approvable from the UI.
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw acceptance" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(actions.withdrawRiskAcceptanceAction).toHaveBeenCalledWith("f-1", "ra-appr", { reason: undefined });
  });

  it("a legacy_unverified acceptance offers Withdraw & reopen, never Approve", async () => {
    raOn([
      aRiskAcceptance({
        id: "ra-legacy",
        state: "legacy_unverified",
        governance_review_required: true,
        owner_user_id: null,
        rationale: null,
        requested_by_user_id: null,
        expires_at: null,
      }),
    ]);

    await renderPage(FindingDetailPage, props());

    expect(screen.getByText("Historical — unverified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw & reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("evidence can be attached to a live acceptance, reusing the evidence primitive", async () => {
    raOn([aRiskAcceptance({ id: "ra-9", state: "proposed", requested_by_user_id: "user-1", evidence_count: 1 })]);
    signedIn({ userId: "user-2" });

    await renderPage(FindingDetailPage, props());

    // The count is shown; attaching drives the shared evidence action with the acceptance id.
    expect(screen.getByText("Evidence (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach evidence" }));
    fireEvent.change(screen.getByLabelText("Evidence title"), { target: { value: "Risk committee minutes" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    expect(actions.attachRiskAcceptanceEvidenceAction).toHaveBeenCalledWith("f-1", "ra-9", {
      title: "Risk committee minutes",
      evidence_type: "document",
      external_ref: undefined,
    });
  });

  it("terminal records render as history under the live record", async () => {
    raOn([
      aRiskAcceptance({ id: "live", state: "proposed", requested_by_user_id: "user-1" }),
      aRiskAcceptance({ id: "gone", state: "rejected", approver_user_id: "user-2", decision_rationale: "not enough control", updated_at: "2026-07-02T00:00:00Z" }),
    ]);

    await renderPage(FindingDetailPage, props());

    expect(screen.getByText("History (1)")).toBeInTheDocument();
    expect(screen.getByText(/not enough control/)).toBeInTheDocument();
  });
});
