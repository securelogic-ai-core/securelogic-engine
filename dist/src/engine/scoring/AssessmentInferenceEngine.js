"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssessmentInferenceEngine = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
class AssessmentInferenceEngine {
    static infer(controlState) {
        return Object.entries(ControlRegistry_1.ControlRegistry.controls).map(([path, definition]) => {
            const [domain, control] = path.split(".");
            const observed = controlState[domain]?.[control] === true;
            return {
                controlId: definition.id,
                controlPath: path,
                satisfied: observed,
                implemented: observed,
                maturityLevel: observed ? 3 : 1,
                evidenceProvided: observed,
                riskAccepted: false
            };
        });
    }
}
exports.AssessmentInferenceEngine = AssessmentInferenceEngine;
