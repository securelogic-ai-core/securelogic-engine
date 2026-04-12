import { describe, it, expect } from "vitest";
import { DecisionDiffEngine } from "../../../engine/explain/DecisionDiffEngine.js";

describe("DecisionDiffEngine edge cases (frozen contract)", () => {
  it("identical decisions produce no-change diff with stable summary", () => {
    const snapshot = {
      decision: {
        severity: "Critical",
        drivers: ["AI Risk Ownership Defined", "Data Lineage Tracked"],
      },
    };

    const result = DecisionDiffEngine.diff(snapshot, snapshot);

    expect(result.severityChanged).toBe(false);
    expect(result.fromSeverity).toBe("Critical");
    expect(result.toSeverity).toBe("Critical");
    expect(result.addedDrivers).toEqual([]);
    expect(result.removedDrivers).toEqual([]);
    expect(result.domainScoreChanges).toEqual([]);
    expect(result.summary).toBe("No material decision differences detected.");
  });

  it("decisions without trace produce empty domainScoreChanges", () => {
    const before = {
      decision: { severity: "High", drivers: ["Governance"] },
    };
    const after = {
      decision: { severity: "Critical", drivers: ["Governance", "DataQuality"] },
    };

    const result = DecisionDiffEngine.diff(before, after);

    expect(result.severityChanged).toBe(true);
    expect(result.domainScoreChanges).toEqual([]);
    expect(result.addedDrivers).toEqual(["DataQuality"]);
    expect(result.removedDrivers).toEqual([]);
  });
});
