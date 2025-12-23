"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlAssessmentEngine = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
var ControlAssessmentEngine = /** @class */ (function () {
    function ControlAssessmentEngine() {
    }
    ControlAssessmentEngine.assess = function (_input) {
        return Object.keys(ControlRegistry_1.ControlRegistry.controls).map(function (controlId) { return ({
            controlId: controlId,
            controlPath: controlId,
            implemented: false,
            satisfied: false,
            maturityLevel: 0,
            riskAccepted: false,
            evidenceProvided: false
        }); });
    };
    return ControlAssessmentEngine;
}());
exports.ControlAssessmentEngine = ControlAssessmentEngine;
