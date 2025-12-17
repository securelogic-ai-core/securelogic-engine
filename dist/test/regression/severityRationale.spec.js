"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const RunnerEngine_1 = require("../../src/engine/RunnerEngine");
const test_json_1 = __importDefault(require("../../test.json"));
describe("Severity Rationale Regression", () => {
    it("accumulates all severity rationales without overwrite", () => {
        const result = RunnerEngine_1.RunnerEngine.run(test_json_1.default);
        const rationale = result.enterprise.severityRationale;
        expect(Array.isArray(rationale)).toBe(true);
        expect(rationale).toContain("Governance risk exceeds 30% of total enterprise risk");
        expect(rationale).toContain("Enterprise severity escalated due to governance materiality");
        expect(rationale).toContain("Governance and Monitoring weaknesses compound systemic AI risk");
        expect(rationale).toContain("Governance and resilience gaps create compounding operational risk");
    });
});
