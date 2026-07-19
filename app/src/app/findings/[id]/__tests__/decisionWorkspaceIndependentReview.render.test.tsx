/**
 * decisionWorkspaceIndependentReview.render.test.tsx — Independent Governance Review
 * waiting state + close-control gating in the Decision Workspace (spec §6).
 *
 * When the workflow is active (context.review.independent_review_active) and a remediated
 * finding still awaits its governance decision, a viewer who is NOT the assigned reviewer
 * (the remediator is the primary case) must see a "Pending Independent Review" waiting card
 * and must NOT be offered the Resolved / Accept-Risk close controls the close-time SoD gate
 * would refuse — and never an error banner. The assigned reviewer keeps the controls.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionWorkspace } from "../DecisionWorkspace";
import { aFinding, aFindingContext } from "@/test/fixtures";

// jsdom has no Next router / search params, and the server actions are "use server".
// Stubs suffice — these tests assert what is RENDERED, not navigation or submission.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../actions", () => ({
  updateFindingStatusAction: vi.fn(),
  updateFindingPriorityAction: vi.fn(),
  updateFindingDecisionStateAction: vi.fn(),
  markFindingReviewedAction: vi.fn(),
  assignFindingOwnerAction: vi.fn(),
}));

const REVIEWER = { id: "reviewer-1", email: "rev@x.com", name: "Rev Iewer" };

/** A remediated finding awaiting its governance decision, under active independent review. */
function pendingReviewContext() {
  return aFindingContext({
    finding: {
      id: "f-1",
      source_type: "manual",
      source_id: null,
      decision_state: "needs_review",
      operational_status: "remediated",
    },
    review: {
      independent_review_active: true,
      reviewer: REVIEWER,
      remediator_user_id: "remediator-1",
    },
  });
}

function renderWorkspace(currentUserId: string) {
  return render(
    <DecisionWorkspace
      finding={aFinding({ operational_status: "remediated", status: "in_progress" })}
      context={pendingReviewContext()}
      currentUserId={currentUserId}
      riskAcceptanceFeatureOn={false}
    >
      <div>remediation zone</div>
    </DecisionWorkspace>
  );
}

describe("Decision Workspace — independent review waiting state (non-reviewer)", () => {
  it("shows the waiting card with the assigned reviewer", () => {
    renderWorkspace("remediator-1");
    expect(screen.getByText("Pending Independent Review")).toBeTruthy();
    expect(screen.getByText(/Rev Iewer/)).toBeTruthy();
  });

  it("suppresses the Resolved and Accept-Risk close controls", () => {
    const { container } = renderWorkspace("remediator-1");
    // The governance decision dropdown drops the CLOSE targets for a non-reviewer…
    expect(container.querySelector('option[value="resolved"]')).toBeNull();
    expect(container.querySelector('option[value="accepted_risk"]')).toBeNull();
    // …while non-close transitions remain available.
    expect(container.querySelector('option[value="mitigating"]')).not.toBeNull();
    // The legacy one-click Accept Risk button is gone too.
    expect(screen.queryByRole("button", { name: "Accept Risk" })).toBeNull();
    // And the "record decision" hand-off CTA — the door to the close panel — is not offered.
    expect(screen.queryByRole("button", { name: /Record decision/ })).toBeNull();
  });

  it("shows no error banner (the dead 409 action is never reached)", () => {
    renderWorkspace("remediator-1");
    // The 409 separation-of-duties REFUSAL copy must never appear — the remediator is
    // never offered the control, so the engine's "Cannot close…" message is unreachable.
    expect(screen.queryByText(/Cannot close/i)).toBeNull();
    // The error-banner affordance (only rendered on a refused action) is absent.
    expect(screen.queryByRole("button", { name: /View remediation/ })).toBeNull();
    // The waiting card is informational (role=status), not an alert/error.
    expect(screen.getByText("Pending Independent Review").closest('[role="status"]')).toBeTruthy();
  });
});

describe("Decision Workspace — the assigned reviewer keeps the controls", () => {
  it("no waiting card, and the Resolved control is available", () => {
    const { container } = renderWorkspace("reviewer-1");
    expect(screen.queryByText("Pending Independent Review")).toBeNull();
    // Governance controls unchanged: the reviewer can record the closure decision.
    expect(container.querySelector('option[value="resolved"]')).not.toBeNull();
  });
});
