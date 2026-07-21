/**
 * findingLifecycleVocab — the canonical, shared vocabulary for a finding's two
 * lifecycle axes. These tests pin the contract every findings surface now relies
 * on: the two axes are never conflated, the labels are stable, and the lifecycle
 * stage is derived correctly from (operational_status, decision_state).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DECISION_STATE_LABELS,
  OPERATIONAL_STATUS_LABELS,
  GOVERNANCE_AXIS_LABEL,
  OPERATIONAL_AXIS_LABEL,
  decisionStateLabel,
  operationalStatusLabel,
  GovernanceStateBadge,
  OperationalStateBadge,
  lifecycleStageIndex,
  lifecycleSummary,
  LifecycleIndicator,
  LIFECYCLE_STAGES,
  QUEUE_OVERLAP_NOTE,
  whyInMyWork,
} from "../findingLifecycleVocab";

describe("canonical axis labels", () => {
  it("names the two axes so a user never has to infer governance from a control", () => {
    expect(GOVERNANCE_AXIS_LABEL).toBe("Governance Decision");
    expect(OPERATIONAL_AXIS_LABEL).toBe("Operational Status");
  });

  it("covers every canonical enum value for both axes", () => {
    expect(Object.keys(DECISION_STATE_LABELS).sort()).toEqual(
      ["accepted_risk", "mitigating", "needs_review", "resolved"],
    );
    // operational_status: open | in_progress | remediated | closed
    expect(Object.keys(OPERATIONAL_STATUS_LABELS).sort()).toEqual(
      ["closed", "in_progress", "open", "remediated"],
    );
  });

  it("remediated reads as 'Remediation complete' — never mistakable for a governance close", () => {
    expect(operationalStatusLabel("remediated")).toBe("Remediation complete");
    expect(decisionStateLabel("resolved")).toBe("Resolved");
    // The two words for the two axes are distinct.
    expect(operationalStatusLabel("remediated")).not.toBe(decisionStateLabel("resolved"));
  });

  it("unknown / null values fall back to an em-dash, never a crash", () => {
    expect(decisionStateLabel(null)).toBe("—");
    expect(operationalStatusLabel(undefined)).toBe("—");
    expect(decisionStateLabel("weird")).toBe("weird");
  });
});

describe("governance vs operational badges render on separate axes (F-3 / MW-3)", () => {
  it("labels the governance badge as governance and the operational badge as ops", () => {
    render(
      <>
        <GovernanceStateBadge value="accepted_risk" />
        <OperationalStateBadge value="remediated" />
      </>,
    );
    expect(screen.getByText("Governance:")).toBeInTheDocument();
    expect(screen.getByText("Accepted Risk")).toBeInTheDocument();
    expect(screen.getByText("Ops:")).toBeInTheDocument();
    expect(screen.getByText("Remediation complete")).toBeInTheDocument();
  });

  it("renders nothing for an absent value (no empty chip)", () => {
    const { container } = render(<GovernanceStateBadge value={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("lifecycle stage derivation (R-21 / R-22)", () => {
  it("progresses assessed → remediation → governance → closed across the two axes", () => {
    // fresh finding: assessed
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("open", "needs_review")]).toBe("Assessed");
    // work started
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("in_progress", "needs_review")]).toBe("Remediation");
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("open", "mitigating")]).toBe("Remediation");
    // remediation done but not decided → GOVERNANCE (the crux the walkthrough missed)
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("remediated", "needs_review")]).toBe("Governance");
    // accepted risk is a governance decision on record, not yet closed
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("in_progress", "accepted_risk")]).toBe("Governance");
    // closed
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("remediated", "resolved")]).toBe("Closed");
    expect(LIFECYCLE_STAGES[lifecycleStageIndex("closed", "resolved")]).toBe("Closed");
  });

  it("a remediated/undecided finding says governance decision is required next (R-7)", () => {
    const s = lifecycleSummary("remediated", "needs_review");
    expect(s.stage).toBe("Governance");
    expect(s.nextAction).toMatch(/governance decision required/i);
  });

  it("renders a stepper marking the current stage", () => {
    render(<LifecycleIndicator operationalStatus="remediated" decisionState="needs_review" />);
    const current = screen.getByText("Governance");
    expect(current.getAttribute("aria-current")).toBe("step");
  });
});

describe("queue overlap + my-work reason", () => {
  it("discloses that queues overlap (F-2)", () => {
    expect(QUEUE_OVERLAP_NOTE.toLowerCase()).toContain("overlap");
    expect(QUEUE_OVERLAP_NOTE.toLowerCase()).toContain("several at once");
  });

  it("explains a My Work card only when the caller literally owns it (MW-7)", () => {
    expect(whyInMyWork({ owner_user_id: "u-1" }, "u-1")).toBe("You own this finding");
    expect(whyInMyWork({ owner_user_id: "u-2" }, "u-1")).toBeNull();
    expect(whyInMyWork({ owner_user_id: null }, "u-1")).toBeNull();
    expect(whyInMyWork({ owner_user_id: "u-1" }, null)).toBeNull();
  });
});
