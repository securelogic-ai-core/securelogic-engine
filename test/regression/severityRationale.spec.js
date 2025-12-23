"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var RunnerEngine_1 = require("../../src/engine/RunnerEngine");
var test_json_1 = require("../../test.json");
describe("Severity Rationale Regression", function () {
    it("accumulates all severity rationales without overwrite", function () {
        var result = RunnerEngine_1.RunnerEngine.run(test_json_1.default);
        var rationale = result.enterprise.severityRationale;
        expect(Array.isArray(rationale)).toBe(true);
        expect(rationale).toContain("Governance risk exceeds 30% of total enterprise risk");
        expect(rationale).toContain("Enterprise severity escalated due to governance materiality");
        expect(rationale).toContain("Governance and Monitoring weaknesses compound systemic AI risk");
        expect(rationale).toContain("Governance and resilience gaps create compounding operational risk");
    });
});
