"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssessmentInferenceEngine = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
var AssessmentInferenceEngine = /** @class */ (function () {
    function AssessmentInferenceEngine() {
    }
    AssessmentInferenceEngine.infer = function (controlState) {
        return Object.entries(ControlRegistry_1.ControlRegistry.controls).map(function (_a) {
            var _b;
            var path = _a[0], definition = _a[1];
            var _c = path.split("."), domain = _c[0], control = _c[1];
            var observed = ((_b = controlState[domain]) === null || _b === void 0 ? void 0 : _b[control]) === true;
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
    };
    return AssessmentInferenceEngine;
}());
exports.AssessmentInferenceEngine = AssessmentInferenceEngine;
