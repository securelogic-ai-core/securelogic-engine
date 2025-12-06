"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngineV3 = void 0;
const RuleEngine_1 = __importDefault(require("./RuleEngine"));
const MissingEvidenceRule_1 = __importDefault(require("./rules/MissingEvidenceRule"));
const MissingPoliciesRule_1 = __importDefault(require("./rules/MissingPoliciesRule"));
const MissingProceduresRule_1 = __importDefault(require("./rules/MissingProceduresRule"));
class ScoringEngineV3 {
    constructor() {
        this.ruleEngine = new RuleEngine_1.default([
            new MissingEvidenceRule_1.default(),
            new MissingPoliciesRule_1.default(),
            new MissingProceduresRule_1.default()
        ]);
    }
    score(controls, intake) {
        return controls.map((ctrl) => {
            const findings = this.ruleEngine.evaluate(ctrl, intake);
            let risk = ctrl.impact + ctrl.likelihood;
            findings.forEach((f) => {
                if (f.deduction && f.deduction > 0) {
                    risk += f.deduction;
                }
            });
            return {
                id: ctrl.id,
                title: ctrl.title,
                domain: ctrl.domain,
                impact: ctrl.impact,
                likelihood: ctrl.likelihood,
                risk,
                findings
            };
        });
    }
}
exports.ScoringEngineV3 = ScoringEngineV3;
exports.default = ScoringEngineV3;
