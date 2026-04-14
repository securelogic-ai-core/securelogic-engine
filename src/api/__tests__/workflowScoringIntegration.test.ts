import { describe, it, expect } from "vitest";
import {
  buildWorkflowSignalBreakdown,
  buildScoringRationaleExtension,
  type WorkflowSignalBreakdown
} from "../lib/workflowScoringIntegration.js";

// ====================================================================
// buildWorkflowSignalBreakdown — empty inputs
// ====================================================================

describe("buildWorkflowSignalBreakdown — empty inputs", () => {
  it("returns total_signals=0 with no rows and no risk signals", () => {
    const b = buildWorkflowSignalBreakdown([], 0, 0);
    expect(b.total_signals).toBe(0);
  });

  it("returns finding_signals=0 with no finding rows", () => {
    const b = buildWorkflowSignalBreakdown([], 0, 0);
    expect(b.finding_signals).toBe(0);
  });

  it("returns risk_signals=0 with riskSignalCount=0", () => {
    const b = buildWorkflowSignalBreakdown([], 0, 0);
    expect(b.risk_signals).toBe(0);
  });

  it("returns empty by_source_type with no rows", () => {
    const b = buildWorkflowSignalBreakdown([], 0, 0);
    expect(Object.keys(b.by_source_type)).toHaveLength(0);
  });

  it("returns risks_with_active_treatment=0", () => {
    const b = buildWorkflowSignalBreakdown([], 0, 0);
    expect(b.risks_with_active_treatment).toBe(0);
  });
});

// ====================================================================
// buildWorkflowSignalBreakdown — finding signals
// ====================================================================

describe("buildWorkflowSignalBreakdown — finding signals by source_type", () => {
  it("counts obligation_review findings", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "obligation_review", count: "4" }],
      0,
      0
    );
    expect(b.by_source_type["obligation_review"]).toBe(4);
    expect(b.finding_signals).toBe(4);
  });

  it("counts ai_governance_review findings", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "ai_governance_review", count: "2" }],
      0,
      0
    );
    expect(b.by_source_type["ai_governance_review"]).toBe(2);
  });

  it("counts dependency_review findings", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "dependency_review", count: "1" }],
      0,
      0
    );
    expect(b.by_source_type["dependency_review"]).toBe(1);
  });

  it("counts vendor_cycle_review findings", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "vendor_cycle_review", count: "3" }],
      0,
      0
    );
    expect(b.by_source_type["vendor_cycle_review"]).toBe(3);
  });

  it("counts manual findings", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "manual", count: "2" }],
      0,
      0
    );
    expect(b.by_source_type["manual"]).toBe(2);
  });

  it("counts multiple source types independently", () => {
    const b = buildWorkflowSignalBreakdown(
      [
        { source_type: "obligation_review", count: "3" },
        { source_type: "ai_governance_review", count: "2" },
        { source_type: "vendor_cycle_review", count: "1" }
      ],
      0,
      0
    );
    expect(b.by_source_type["obligation_review"]).toBe(3);
    expect(b.by_source_type["ai_governance_review"]).toBe(2);
    expect(b.by_source_type["vendor_cycle_review"]).toBe(1);
    expect(b.finding_signals).toBe(6);
  });

  it("total_signals = finding_signals when no risk signals", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "control_test", count: "5" }],
      0,
      0
    );
    expect(b.total_signals).toBe(b.finding_signals);
    expect(b.total_signals).toBe(5);
  });

  it("skips rows with zero count", () => {
    const b = buildWorkflowSignalBreakdown(
      [
        { source_type: "manual", count: "0" },
        { source_type: "obligation_review", count: "2" }
      ],
      0,
      0
    );
    expect("manual" in b.by_source_type).toBe(false);
    expect(b.finding_signals).toBe(2);
  });

  it("skips rows with non-numeric count", () => {
    const b = buildWorkflowSignalBreakdown(
      [
        { source_type: "signal", count: "NaN" },
        { source_type: "manual", count: "3" }
      ],
      0,
      0
    );
    expect("signal" in b.by_source_type).toBe(false);
    expect(b.finding_signals).toBe(3);
  });
});

// ====================================================================
// buildWorkflowSignalBreakdown — risk signals
// ====================================================================

describe("buildWorkflowSignalBreakdown — risk signals", () => {
  it("counts risk signals separately from finding signals", () => {
    const b = buildWorkflowSignalBreakdown([], 5, 0);
    expect(b.risk_signals).toBe(5);
    expect(b.finding_signals).toBe(0);
    expect(b.total_signals).toBe(5);
  });

  it("total_signals = finding_signals + risk_signals", () => {
    const b = buildWorkflowSignalBreakdown(
      [{ source_type: "obligation_review", count: "3" }],
      4,
      0
    );
    expect(b.total_signals).toBe(7);
    expect(b.finding_signals).toBe(3);
    expect(b.risk_signals).toBe(4);
  });

  it("clamps negative riskSignalCount to 0", () => {
    const b = buildWorkflowSignalBreakdown([], -1, 0);
    expect(b.risk_signals).toBe(0);
    expect(b.total_signals).toBe(0);
  });
});

// ====================================================================
// buildWorkflowSignalBreakdown — treatment transparency
// ====================================================================

describe("buildWorkflowSignalBreakdown — risks_with_active_treatment", () => {
  it("records the treatment count", () => {
    const b = buildWorkflowSignalBreakdown([], 5, 2);
    expect(b.risks_with_active_treatment).toBe(2);
  });

  it("clamps negative treatment count to 0", () => {
    const b = buildWorkflowSignalBreakdown([], 5, -3);
    expect(b.risks_with_active_treatment).toBe(0);
  });

  it("allows treatment count equal to risk signal count", () => {
    const b = buildWorkflowSignalBreakdown([], 3, 3);
    expect(b.risks_with_active_treatment).toBe(3);
  });

  it("does not affect total_signals (treated risks still score)", () => {
    const b1 = buildWorkflowSignalBreakdown([], 5, 0);
    const b2 = buildWorkflowSignalBreakdown([], 5, 3);
    expect(b1.total_signals).toBe(b2.total_signals);
    expect(b1.risk_signals).toBe(b2.risk_signals);
  });
});

// ====================================================================
// buildScoringRationaleExtension — structure
// ====================================================================

describe("buildScoringRationaleExtension — structure", () => {
  function makeBreakdown(overrides: Partial<WorkflowSignalBreakdown> = {}): WorkflowSignalBreakdown {
    return {
      total_signals: 5,
      finding_signals: 3,
      risk_signals: 2,
      by_source_type: { obligation_review: 2, manual: 1 },
      risks_with_active_treatment: 0,
      ...overrides
    };
  }

  it("returns workflow_signal_breakdown key", () => {
    const ext = buildScoringRationaleExtension(makeBreakdown());
    expect("workflow_signal_breakdown" in ext).toBe(true);
  });

  it("workflow_signal_breakdown contains total_signals", () => {
    const ext = buildScoringRationaleExtension(makeBreakdown({ total_signals: 5 }));
    const wb = ext["workflow_signal_breakdown"] as Record<string, unknown>;
    expect(wb["total_signals"]).toBe(5);
  });

  it("workflow_signal_breakdown contains finding_signals", () => {
    const ext = buildScoringRationaleExtension(makeBreakdown({ finding_signals: 3 }));
    const wb = ext["workflow_signal_breakdown"] as Record<string, unknown>;
    expect(wb["finding_signals"]).toBe(3);
  });

  it("workflow_signal_breakdown contains risk_signals", () => {
    const ext = buildScoringRationaleExtension(makeBreakdown({ risk_signals: 2 }));
    const wb = ext["workflow_signal_breakdown"] as Record<string, unknown>;
    expect(wb["risk_signals"]).toBe(2);
  });

  it("workflow_signal_breakdown contains by_source_type", () => {
    const b = makeBreakdown({ by_source_type: { obligation_review: 2, manual: 1 } });
    const ext = buildScoringRationaleExtension(b);
    const wb = ext["workflow_signal_breakdown"] as Record<string, unknown>;
    const bst = wb["by_source_type"] as Record<string, unknown>;
    expect(bst["obligation_review"]).toBe(2);
    expect(bst["manual"]).toBe(1);
  });
});

// ====================================================================
// buildScoringRationaleExtension — treatment note
// ====================================================================

describe("buildScoringRationaleExtension — treatment note", () => {
  it("does NOT include risks_under_active_treatment when count is 0", () => {
    const b: WorkflowSignalBreakdown = {
      total_signals: 3,
      finding_signals: 3,
      risk_signals: 0,
      by_source_type: {},
      risks_with_active_treatment: 0
    };
    const ext = buildScoringRationaleExtension(b);
    expect("risks_under_active_treatment" in ext).toBe(false);
    expect("treatment_note" in ext).toBe(false);
  });

  it("includes risks_under_active_treatment when count > 0", () => {
    const b: WorkflowSignalBreakdown = {
      total_signals: 5,
      finding_signals: 2,
      risk_signals: 3,
      by_source_type: {},
      risks_with_active_treatment: 2
    };
    const ext = buildScoringRationaleExtension(b);
    expect(ext["risks_under_active_treatment"]).toBe(2);
  });

  it("includes treatment_note string when count > 0", () => {
    const b: WorkflowSignalBreakdown = {
      total_signals: 5,
      finding_signals: 2,
      risk_signals: 3,
      by_source_type: {},
      risks_with_active_treatment: 1
    };
    const ext = buildScoringRationaleExtension(b);
    expect(typeof ext["treatment_note"]).toBe("string");
    expect((ext["treatment_note"] as string).length).toBeGreaterThan(0);
  });

  it("treatment_note references the count", () => {
    const b: WorkflowSignalBreakdown = {
      total_signals: 5,
      finding_signals: 2,
      risk_signals: 3,
      by_source_type: {},
      risks_with_active_treatment: 3
    };
    const ext = buildScoringRationaleExtension(b);
    expect(ext["treatment_note"] as string).toContain("3");
  });

  it("treatment_note mentions terminal state", () => {
    const b: WorkflowSignalBreakdown = {
      total_signals: 5,
      finding_signals: 2,
      risk_signals: 3,
      by_source_type: {},
      risks_with_active_treatment: 1
    };
    const ext = buildScoringRationaleExtension(b);
    expect(ext["treatment_note"] as string).toContain("terminal");
  });
});

// ====================================================================
// Determinism — same inputs always produce same output
// ====================================================================

describe("buildWorkflowSignalBreakdown — determinism", () => {
  it("produces identical output for identical inputs (call 1 vs call 2)", () => {
    const rows = [
      { source_type: "obligation_review", count: "3" },
      { source_type: "vendor_cycle_review", count: "1" }
    ];
    const b1 = buildWorkflowSignalBreakdown(rows, 2, 1);
    const b2 = buildWorkflowSignalBreakdown(rows, 2, 1);
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));
  });
});
