"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlRiskScoringEngine = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
class ControlRiskScoringEngine {
    static score(assessments, input) {
        return assessments.map(a => {
            const definition = ControlRegistry_1.ControlRegistry.controls[a.controlPath];
            const modifierScore = a.satisfied ? 0 : 2;
            const maturityPenalty = a.satisfied ? 0 : 1;
            const totalRiskScore = definition.baseWeight +
                modifierScore +
                maturityPenalty;
            return {
                controlId: definition.id,
                baseWeight: definition.baseWeight,
                modifierScore,
                maturityPenalty,
                totalRiskScore,
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
                        modifierScore,
                        maturityPenalty,
                        totalRiskScore
                    },
                    rationale: `Risk derived from control ${definition.id} (${definition.title})`
                }
            };
        });
    }
}
exports.ControlRiskScoringEngine = ControlRiskScoringEngine;
