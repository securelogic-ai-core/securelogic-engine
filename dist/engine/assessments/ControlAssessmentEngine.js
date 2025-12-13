"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlAssessmentEngine = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
class ControlAssessmentEngine {
    static assess(_input) {
        return Object.keys(ControlRegistry_1.ControlRegistry.controls).map(controlId => ({
            controlId,
            controlPath: controlId,
            implemented: false,
            satisfied: false,
            maturityLevel: 0,
            riskAccepted: false,
            evidenceProvided: false
        }));
    }
}
exports.ControlAssessmentEngine = ControlAssessmentEngine;
