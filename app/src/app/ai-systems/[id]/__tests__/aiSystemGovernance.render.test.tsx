/**
 * /ai-systems/[id] — the Governance section render contract (AI T2 family).
 *
 * Three claims this surface makes, each with a way to lie that these tests pin shut:
 *
 *   1. ENRICHMENT FACTS. null and [] are different declarations for sensitive data
 *      ("never assessed" vs "assessed: none"), review_overdue is the ENGINE's
 *      computation (not a client re-derivation of "today"), and the reassessment
 *      recommendation renders prominently — it means every assessment and use
 *      approval before it describes a DIFFERENT system.
 *
 *   2. TYPED LINKS. Four families, each with an honest empty state that says what a
 *      link MEANS, and a failed resolve rendered as "could not load" — never as an
 *      empty-but-plausible list.
 *
 *   3. USE DECISION. The current decision carries two staleness facts the engine
 *      computed (materially_changed_since, expired); the page SURFACES them as
 *      warnings and never recomputes them. "Never decided" (count 0) and "could not
 *      load" (null) are different facts with different renders.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderPage, signedIn, sp, hrefOf } from "@/test/harness";
import {
  anAiGovernanceAssessment,
  anAiGovernanceAssessmentsResponse,
  anAiSystem,
  anAiSystemGovernanceLink,
  anAiUseApproval,
  anAiUseApprovalsResponse,
} from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getAiSystem: vi.fn(),
  getGovernanceReviewsForSystem: vi.fn(),
  getAiGovernanceAssessments: vi.fn(),
  getAiSystemFindings: vi.fn(),
  getAiSystemSignals: vi.fn(),
  getAiSystemVendorDependencies: vi.fn(),
  getVendors: vi.fn(),
  getAiSystemGovernanceLinks: vi.fn(),
  getAiUseApprovals: vi.fn(),
  getTeamMembers: vi.fn(),
  getFrameworks: vi.fn(),
  getControls: vi.fn(),
  getPolicies: vi.fn(),
  getObligations: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

// FindingCard/AssessmentStatusCard and the governance forms import server actions,
// which import next/cache — no request scope in a test process.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import AiSystemDetailPage from "../page";

const props = (id = "ai-1") => ({ params: sp({ id }) as Promise<{ id: string }> });

const emptyFindings = { findings: [], total: 0, open_total: 0, active_total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getAiSystem.mockResolvedValue(anAiSystem());
  api.getGovernanceReviewsForSystem.mockResolvedValue({ count: 0, reviews: [] });
  api.getAiGovernanceAssessments.mockResolvedValue({ count: 0, assessments: [] });
  api.getAiSystemFindings.mockResolvedValue(emptyFindings);
  api.getAiSystemSignals.mockResolvedValue([]);
  api.getAiSystemVendorDependencies.mockResolvedValue([]);
  api.getVendors.mockResolvedValue(null);
  api.getAiSystemGovernanceLinks.mockResolvedValue([]);
  api.getAiUseApprovals.mockResolvedValue(anAiUseApprovalsResponse([]));
  api.getTeamMembers.mockResolvedValue(null);
  api.getFrameworks.mockResolvedValue(null);
  api.getControls.mockResolvedValue(null);
  api.getPolicies.mockResolvedValue(null);
  api.getObligations.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────
// 1. Enrichment facts
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — governance facts", () => {
  it("renders the classified facts with human labels, and the engine-computed overdue flag", async () => {
    api.getAiSystem.mockResolvedValue(
      anAiSystem({
        eu_ai_act_tier: "high_risk",
        human_oversight_level: "human_in_the_loop",
        sensitive_data_categories: ["phi", "payment_card"],
        review_cadence_days: 90,
        next_review_due: "2026-06-01",
        review_overdue: true,
        material_state_version: 3,
      })
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByText("Human in the loop")).toBeInTheDocument();
    expect(screen.getByText("Payment card")).toBeInTheDocument();
    expect(screen.getByText("Every 90 days")).toBeInTheDocument();
    // The flag is the ENGINE's computation against ITS today — printed, not re-derived.
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("a due date the engine says is NOT overdue carries no overdue chip", async () => {
    api.getAiSystem.mockResolvedValue(
      anAiSystem({ next_review_due: "2027-01-01", review_overdue: false })
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.queryByText("Overdue")).toBeNull();
  });

  it("sensitive data: null is 'never declared' and [] is 'declared: none' — different facts", async () => {
    api.getAiSystem.mockResolvedValue(anAiSystem({ sensitive_data_categories: null }));
    const first = await renderPage(AiSystemDetailPage, props());
    expect(screen.getByText("Never declared")).toBeInTheDocument();
    expect(screen.queryByText("None declared")).toBeNull();
    first.unmount();

    api.getAiSystem.mockResolvedValue(anAiSystem({ sensitive_data_categories: [] }));
    await renderPage(AiSystemDetailPage, props());
    expect(screen.getByText("None declared")).toBeInTheDocument();
    expect(screen.queryByText("Never declared")).toBeNull();
  });

  it("owners resolve to PEOPLE when the team read succeeds — and to the raw id, never silence, when it fails", async () => {
    api.getAiSystem.mockResolvedValue(
      anAiSystem({ business_owner_user_id: "u-biz", owner_user_id: "u-tech" })
    );
    api.getTeamMembers.mockResolvedValue({
      members: [
        { id: "u-biz", email: "dana@example.com", name: "Dana Weiss", role: "admin", status: "active", created_at: "", last_used_at: null },
      ],
      pending_invites: [],
      seat_usage: { used: 1, max: 10 },
    });

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Dana Weiss")).toBeInTheDocument();
    // u-tech is not in the member list: the id renders — someone DOES hold the
    // accountability, and hiding that would read as "unassigned".
    expect(screen.getByText("u-tech")).toBeInTheDocument();
  });

  it("the reassessment recommendation renders PROMINENTLY, with its interrogable reason", async () => {
    api.getAiSystem.mockResolvedValue(
      anAiSystem({
        reassessment_recommended_at: "2026-08-01T00:00:00.000Z",
        reassessment_reason:
          "Material change: eu_ai_act_tier changed on 2026-08-01. Assessments and use approvals recorded against the previous state describe a different system.",
      })
    );

    await renderPage(AiSystemDetailPage, props());

    const banner = screen.getAllByRole("alert").find((el) =>
      (el.textContent ?? "").includes("Reassessment recommended")
    );
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("describe a different system");
  });

  it("no recommendation on file → no banner implying one", async () => {
    await renderPage(AiSystemDetailPage, props());
    expect(screen.queryByText(/Reassessment recommended/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. The four typed governance links
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — governance links", () => {
  it("fetches all four families for THIS system and renders each target by name, deep-linked", async () => {
    api.getAiSystemGovernanceLinks.mockImplementation(
      async (_token: string, _id: string, kind: string) =>
        kind === "framework"
          ? [anAiSystemGovernanceLink({ id: "gl-f", target_id: "fw-9", target_name: "ISO/IEC 42001" })]
          : kind === "control"
          ? [anAiSystemGovernanceLink({ id: "gl-c", target_id: "c-3", target_name: "Model output review" })]
          : []
    );

    const { container } = await renderPage(AiSystemDetailPage, props("ai-1"));

    for (const kind of ["framework", "control", "policy", "obligation"]) {
      expect(api.getAiSystemGovernanceLinks).toHaveBeenCalledWith("test-jwt", "ai-1", kind);
    }
    expect(hrefOf(container, "ISO/IEC 42001")).toBe("/frameworks/fw-9");
    expect(hrefOf(container, "Model output review")).toBe("/controls/c-3");
  });

  it("empty lists say what a link MEANS — all four families, honestly empty", async () => {
    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText(/No frameworks linked\./)).toBeInTheDocument();
    expect(screen.getByText(/No controls linked\./)).toBeInTheDocument();
    expect(screen.getByText(/No policies linked\./)).toBeInTheDocument();
    expect(screen.getByText(/No obligations linked\./)).toBeInTheDocument();
  });

  it("a FAILED links resolve is not an empty list — it says so", async () => {
    api.getAiSystemGovernanceLinks.mockImplementation(
      async (_token: string, _id: string, kind: string) => (kind === "framework" ? null : [])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText(/Could not load frameworks/)).toBeInTheDocument();
    expect(screen.queryByText(/No frameworks linked\./)).toBeNull();
    // The other three resolved fine and stay honest empties.
    expect(screen.getByText(/No controls linked\./)).toBeInTheDocument();
  });

  it("a manager with targets to pick from gets the add affordances; a viewer gets none", async () => {
    api.getFrameworks.mockResolvedValue({
      count: 1,
      limit: 100,
      organizationId: "org-1",
      nextCursor: null,
      frameworks: [{ id: "fw-1", organization_id: "org-1", name: "NIST AI RMF", version: "1.0", created_at: "", updated_at: "" }],
    });

    const managerView = await renderPage(AiSystemDetailPage, props());
    expect(screen.getByRole("button", { name: "+ Link framework" })).toBeInTheDocument();
    managerView.unmount();

    signedIn({ userRole: "viewer" });
    await renderPage(AiSystemDetailPage, props());
    expect(screen.queryByRole("button", { name: "+ Link framework" })).toBeNull();
    // The picker lists are not even fetched for a session that may not manage.
    expect(api.getFrameworks).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. The use decision and its staleness facts
// ─────────────────────────────────────────────────────────────────────

describe("/ai-systems/[id] — use decision", () => {
  it("renders the current decision with approver, expiry, conditions and rationale", async () => {
    api.getAiSystem.mockResolvedValue(anAiSystem({ material_state_version: 2 }));
    api.getAiUseApprovals.mockResolvedValue(
      anAiUseApprovalsResponse([
        anAiUseApproval({
          decision: "approved_with_conditions",
          rationale: "Approved for internal use only.",
          conditions: "No customer-facing output without human review.",
          decided_by_user_id: "u-1",
          expires_at: "2027-01-01",
          material_state_version: 2,
        }),
      ])
    );
    api.getTeamMembers.mockResolvedValue({
      members: [{ id: "u-1", email: "ciso@example.com", name: "Priya Shah", role: "admin", status: "active", created_at: "", last_used_at: null }],
      pending_invites: [],
      seat_usage: { used: 1, max: 10 },
    });

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Approved with conditions")).toBeInTheDocument();
    expect(screen.getByText("Approved for internal use only.")).toBeInTheDocument();
    expect(screen.getByText(/No customer-facing output without human review\./)).toBeInTheDocument();
    expect(screen.getByText(/by Priya Shah/)).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
    // Un-stale decision: no warnings implying otherwise.
    expect(screen.queryByText(/materially changed/)).toBeNull();
    expect(screen.queryByText(/expired/)).toBeNull();
  });

  it("materially_changed_since — the ENGINE's fact — renders as a visible warning naming both versions", async () => {
    api.getAiSystem.mockResolvedValue(anAiSystem({ material_state_version: 4 }));
    api.getAiUseApprovals.mockResolvedValue(
      anAiUseApprovalsResponse(
        [anAiUseApproval({ decision: "approved", material_state_version: 2 })],
        { materially_changed_since: true }
      )
    );

    await renderPage(AiSystemDetailPage, props());

    const warning = screen.getAllByRole("alert").find((el) =>
      (el.textContent ?? "").includes("materially changed")
    );
    expect(warning).toBeTruthy();
    // Both versions named: the reviewer can see HOW far the decision has drifted.
    expect(warning!.textContent).toContain("v2");
    expect(warning!.textContent).toContain("v4");
    expect(warning!.textContent).toContain("different system");
  });

  it("an expired approval says so — the engine's expiry fact, not a client date comparison", async () => {
    api.getAiUseApprovals.mockResolvedValue(
      anAiUseApprovalsResponse(
        [anAiUseApproval({ decision: "approved", expires_at: "2026-01-01" })],
        { expired: true }
      )
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText(/This approval expired on/)).toBeInTheDocument();
  });

  it("the decision history renders the superseded rows beneath the current decision", async () => {
    api.getAiUseApprovals.mockResolvedValue(
      anAiUseApprovalsResponse([
        anAiUseApproval({ id: "ua-2", decision: "suspended", decided_at: "2026-07-01T00:00:00.000Z" }),
        anAiUseApproval({ id: "ua-1", decision: "approved", decided_at: "2026-05-01T00:00:00.000Z" }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());

    expect(screen.getByText("Decision history")).toBeInTheDocument();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("never decided renders an honest empty state — and a FAILED resolve does not impersonate it", async () => {
    const neverDecided = await renderPage(AiSystemDetailPage, props());
    expect(screen.getByText(/No use decision has been recorded\./)).toBeInTheDocument();
    neverDecided.unmount();

    api.getAiUseApprovals.mockResolvedValue(null);
    await renderPage(AiSystemDetailPage, props());
    expect(screen.queryByText(/No use decision has been recorded\./)).toBeNull();
    expect(screen.getByText(/Could not load the use decision/)).toBeInTheDocument();
  });

  it("a manager may record a decision; a viewer may not", async () => {
    const managerView = await renderPage(AiSystemDetailPage, props());
    expect(screen.getByRole("button", { name: "+ Record decision" })).toBeInTheDocument();
    managerView.unmount();

    signedIn({ userRole: "viewer" });
    await renderPage(AiSystemDetailPage, props());
    expect(screen.queryByRole("button", { name: "+ Record decision" })).toBeNull();
  });

  it("the decision form offers THIS system's assessments as what the decision was made against", async () => {
    // The wiring proof: the page's already-fetched assessments reach the form.
    api.getAiGovernanceAssessments.mockResolvedValue(
      anAiGovernanceAssessmentsResponse([
        anAiGovernanceAssessment({
          id: "aga-77",
          status: "compliant",
          performed_at: "2026-06-01T00:00:00.000Z",
          summary: "Annual model review",
        }),
      ])
    );

    await renderPage(AiSystemDetailPage, props());
    fireEvent.click(screen.getByRole("button", { name: "+ Record decision" }));

    const picker = screen.getByRole("combobox", { name: "Based on assessment" });
    const labels = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual([
      "No assessment — decided without one",
      "compliant — 2026-06-01 — Annual model review",
    ]);
  });

  it("with no assessments the form offers no picker — an empty dropdown would imply a choice that does not exist", async () => {
    await renderPage(AiSystemDetailPage, props());
    fireEvent.click(screen.getByRole("button", { name: "+ Record decision" }));
    expect(screen.queryByRole("combobox", { name: "Based on assessment" })).toBeNull();
  });
});
