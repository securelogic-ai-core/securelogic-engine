/**
 * FindingCard — the queue card. The walkthrough found it ambiguous: no governance
 * state, no real owner, no urgency, and a "Resolve" button that implied a one-click
 * close. These tests pin the fixes (MW-1..MW-8, R-16/R-22) AND that the legacy
 * flag-off card is unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingCard } from "../FindingCard";
import { aFinding } from "@/test/fixtures";

// The card's server action + router are boundaries; the setup mocks next/navigation.
vi.mock("@/app/actions/updateFindingStatus", () => ({
  updateFindingStatus: vi.fn(async () => ({ ok: true })),
}));

const iso = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

describe("workspace card — governance & operational state are both visible (MW-3)", () => {
  it("shows the governance decision and operational status on distinct, labeled badges", () => {
    render(
      <FindingCard
        finding={aFinding({ decision_state: "accepted_risk", operational_status: "in_progress", status: "in_progress" })}
        revalidateUrl="/findings"
        workspace
      />,
    );
    expect(screen.getByText("Governance:")).toBeInTheDocument();
    expect(screen.getByText("Accepted Risk")).toBeInTheDocument();
    expect(screen.getByText("Ops:")).toBeInTheDocument();
    expect(screen.getByText("Work in progress")).toBeInTheDocument();
  });
});

describe("workspace card — owner, reason, urgency (MW-4/5/7)", () => {
  it("shows the real owner name, not a bare 'Assigned' chip", () => {
    render(
      <FindingCard
        finding={aFinding({ owner_user_id: "u-1" })}
        revalidateUrl="/findings"
        workspace
        ownerName="Dana Ops"
        reason="You own this finding"
      />,
    );
    expect(screen.getByText("Dana Ops")).toBeInTheDocument();
    expect(screen.getByText("You own this finding")).toBeInTheDocument();
  });

  it("renders explicit due urgency: overdue by N days / due today", () => {
    const { rerender } = render(
      <FindingCard finding={aFinding({ due_date: iso(-3) })} revalidateUrl="/findings" workspace />,
    );
    expect(screen.getByText("Overdue by 3 days")).toBeInTheDocument();
    rerender(
      <FindingCard finding={aFinding({ id: "f-2", due_date: iso(0) })} revalidateUrl="/findings" workspace />,
    );
    expect(screen.getByText("Due today")).toBeInTheDocument();
  });
});

describe("workspace card — Decision Workspace is the primary action; no ambiguous close (MW-1/6/8)", () => {
  it("exposes 'Open decision' and NOT an ambiguous inline Resolve/Close", () => {
    render(
      <FindingCard
        finding={aFinding({ status: "in_progress", decision_state: "mitigating" })}
        revalidateUrl="/findings"
        workspace
      />,
    );
    expect(screen.getByText(/Open .*decision/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("a remediated finding routes to the GOVERNANCE decision and shows the handoff (R-16/R-22)", () => {
    render(
      <FindingCard
        finding={aFinding({ operational_status: "remediated", decision_state: "needs_review", owner_user_id: "u-1" })}
        revalidateUrl="/findings"
        workspace
        ownerName="Dana Ops"
        queueContext="ready_to_close"
      />,
    );
    expect(screen.getByText(/Remediation complete — governance decision required/i)).toBeInTheDocument();
    expect(screen.getByText(/Decision owner:/i)).toBeInTheDocument();
    expect(screen.getByText("Open governance decision →")).toBeInTheDocument();
  });

  it("the ready-to-close block states the evidence status — attached count or an explicit warning", () => {
    const { rerender } = render(
      <FindingCard
        finding={aFinding({
          operational_status: "remediated",
          decision_state: "needs_review",
          evidence_count: 2,
        })}
        revalidateUrl="/findings"
        workspace
        queueContext="ready_to_close"
      />,
    );
    expect(screen.getByText(/Evidence: 2 items attached/i)).toBeInTheDocument();

    rerender(
      <FindingCard
        finding={aFinding({
          operational_status: "remediated",
          decision_state: "needs_review",
          evidence_count: 0,
        })}
        revalidateUrl="/findings"
        workspace
        queueContext="ready_to_close"
      />,
    );
    expect(
      screen.getByText(/No evidence attached yet — review remediation proof before deciding/i),
    ).toBeInTheDocument();
  });

  it("says nothing about evidence when an older engine omits the count — never a fake zero", () => {
    render(
      <FindingCard
        finding={aFinding({ operational_status: "remediated", decision_state: "needs_review" })}
        revalidateUrl="/findings"
        workspace
        queueContext="ready_to_close"
      />,
    );
    expect(screen.queryByText(/Evidence:/)).toBeNull();
    expect(screen.queryByText(/No evidence attached/)).toBeNull();
  });

  it("the card's decision link preserves the queue it was opened from (?from=, R-19)", () => {
    const { container } = render(
      <FindingCard
        finding={aFinding({ id: "f-42", decision_state: "needs_review" })}
        revalidateUrl="/findings"
        workspace
        queueContext="ready_to_close"
      />,
    );
    // Both the card click and the primary button route through decisionHref;
    // the anchor is what we can assert. Losing ?from= silently drops the
    // ready-to-close handoff banner in the Decision Workspace.
    const link = container.querySelector('a[href="/findings/f-42?from=ready_to_close"]');
    expect(link).not.toBeNull();
  });

  it("every non-my-work queue card states why the finding is in that queue (MW-7)", () => {
    render(
      <FindingCard
        finding={aFinding({ decision_state: "needs_review", owner_user_id: "u-1" })}
        revalidateUrl="/findings"
        workspace
        ownerName="Dana Ops"
        reason="No governance decision recorded yet"
        queueContext="needs_decision"
      />,
    );
    expect(screen.getByText("No governance decision recorded yet")).toBeInTheDocument();
  });
});

describe("legacy card — flag-off is unchanged", () => {
  it("keeps the legacy Resolve transition and shows no governance badge", () => {
    render(
      <FindingCard
        finding={aFinding({ status: "in_progress", decision_state: "mitigating", operational_status: "in_progress" })}
        revalidateUrl="/findings"
      />,
    );
    // Legacy still uses the terse transition buttons, byte-for-byte.
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    // ...and never surfaces the governance axis.
    expect(screen.queryByText("Governance:")).toBeNull();
    expect(screen.queryByText(/Open .*decision/i)).toBeNull();
  });
});
