
import { RunnerEngine } from "../../src/engine/RunnerEngine";
import input from "../../test.json";

describe("Severity Rationale Regression", () => {
  it("accumulates all severity rationales without overwrite", () => {
    const result = RunnerEngine.run(input as any);

    const rationale = (result.enterprise as any).severityRationale;

    expect(Array.isArray(rationale)).toBe(true);

    expect(rationale).toContain(
      "Governance risk exceeds 30% of total enterprise risk"
    );

    expect(rationale).toContain(
      "Enterprise severity escalated due to governance materiality"
    );

    expect(rationale).toContain(
      "Governance and Monitoring weaknesses compound systemic AI risk"
    );

    expect(rationale).toContain(
      "Governance and resilience gaps create compounding operational risk"
    );
  });
});
