"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlRiskScoringEngine = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
class ControlRiskScoringEngine {
    static score(assessments, _input) {
        return assessments.map(a => {
            const definition = ControlRegistry_1.ControlRegistry.controls[a.controlPath];
            if (!definition) {
                throw new Error(`Unknown controlPath: ${a.controlPath}`);
            }
            const satisfactionPenalty = a.satisfied ? 0 : 2;
            const maturityPenalty = a.maturityLevel >= 3 ? 0 :
                a.maturityLevel === 2 ? 1 :
                    a.maturityLevel === 1 ? 2 : 3;
            const acceptancePenalty = a.riskAccepted ? -1 : 0;
            const modifierScore = satisfactionPenalty +
                acceptancePenalty +
                (definition.dynamicModifiers?.genAIUsage ?? 0) +
                (definition.dynamicModifiers?.sensitiveData ?? 0) +
                (definition.dynamicModifiers?.highRiskIndustry ?? 0) +
                (definition.dynamicModifiers?.enterpriseScale ?? 0);
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
