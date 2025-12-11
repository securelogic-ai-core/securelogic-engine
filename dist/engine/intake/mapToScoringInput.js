"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapToScoringInput = mapToScoringInput;
function mapToScoringInput(q) {
    return {
        orgProfile: {
            industry: q.orgProfile.industry,
            size: q.orgProfile.size,
            aiUsage: q.orgProfile.aiUsage
        },
        controls: {
            aiGovernanceDocumented: q.governance.aiGovernanceDocumented,
            modelMonitoring: q.controls.modelMonitoring,
            biasTesting: q.controls.biasTesting,
            incidentResponseForAI: q.controls.incidentResponseForAI,
            inventoryMaintained: q.controls.inventoryMaintained
        }
    };
}
