"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlRiskScoringEngine = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
var ControlRiskScoringEngine = /** @class */ (function () {
    function ControlRiskScoringEngine() {
    }
    ControlRiskScoringEngine.score = function (assessments, _input) {
        return assessments.map(function (a) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            var definition = ControlRegistry_1.ControlRegistry.controls[a.controlPath];
            if (!definition) {
                throw new Error("Unknown controlPath: ".concat(a.controlPath));
            }
            var satisfactionPenalty = a.satisfied ? 0 : 2;
            var maturityPenalty = a.maturityLevel >= 3 ? 0 :
                a.maturityLevel === 2 ? 1 :
                    a.maturityLevel === 1 ? 2 : 3;
            var acceptancePenalty = a.riskAccepted ? -1 : 0;
            var modifierScore = satisfactionPenalty +
                acceptancePenalty +
                ((_b = (_a = definition.dynamicModifiers) === null || _a === void 0 ? void 0 : _a.genAIUsage) !== null && _b !== void 0 ? _b : 0) +
                ((_d = (_c = definition.dynamicModifiers) === null || _c === void 0 ? void 0 : _c.sensitiveData) !== null && _d !== void 0 ? _d : 0) +
                ((_f = (_e = definition.dynamicModifiers) === null || _e === void 0 ? void 0 : _e.highRiskIndustry) !== null && _f !== void 0 ? _f : 0) +
                ((_h = (_g = definition.dynamicModifiers) === null || _g === void 0 ? void 0 : _g.enterpriseScale) !== null && _h !== void 0 ? _h : 0);
            var totalRiskScore = definition.baseWeight +
                modifierScore +
                maturityPenalty;
            return {
                controlId: definition.id,
                baseWeight: definition.baseWeight,
                modifierScore: modifierScore,
                maturityPenalty: maturityPenalty,
                totalRiskScore: totalRiskScore,
                drivers: a.satisfied ? [] : ["Control not satisfied"],
                evidence: {
                    controlId: definition.id,
                    controlTitle: definition.title,
                    observedState: {
                        implemented: a.implemented,
                        maturityLevel: a.maturityLevel,
                        riskAccepted: a.riskAccepted,
                        evidenceProvided: a.evidenceProvided
                    },
                    scoringFactors: {
                        baseWeight: definition.baseWeight,
                        modifierScore: modifierScore,
                        maturityPenalty: maturityPenalty,
                        totalRiskScore: totalRiskScore
                    },
                    rationale: "Risk derived from control ".concat(definition.id, " (").concat(definition.title, ")")
                }
            };
        });
    };
    return ControlRiskScoringEngine;
}());
exports.ControlRiskScoringEngine = ControlRiskScoringEngine;
