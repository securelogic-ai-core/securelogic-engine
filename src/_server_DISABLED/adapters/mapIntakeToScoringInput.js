"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapIntakeToScoringInput = mapIntakeToScoringInput;
var EMPTY_CONTROL_STATE = {
    governance: {
        aiGovernancePolicy: false,
        riskOwnerAssigned: false,
        rolesDefined: false,
        oversightCommittee: false,
        governanceWorkflow: false,
    },
    dataQuality: {
        dataLineage: false,
        dataQualityChecks: false,
        piiManagement: false,
        dataRetention: false,
    },
    modelDevelopment: {
        validationTesting: false,
        biasTesting: false,
        modelApproval: false,
    },
    monitoring: {
        driftDetection: false,
        incidentResponse: false,
    },
    security: {
        modelRepoSecurity: false,
        adversarialDefenses: false,
        vulnScanning: false,
    },
    businessContinuity: {
        backupTesting: false,
        recoveryPlan: false,
    },
    humanOversight: {
        humanInLoop: false,
    },
};
function mapIntakeToScoringInput(uro) {
    var _a, _b, _c;
    var org = (_a = uro.metadata) === null || _a === void 0 ? void 0 : _a.orgProfile;
    if (!org) {
        throw new Error("Missing orgProfile in intake metadata");
    }
    return {
        orgProfile: {
            industry: org.industry,
            size: org.size,
            aiUsage: (_b = org.aiUsage) !== null && _b !== void 0 ? _b : [],
            modelTypes: (_c = org.modelTypes) !== null && _c !== void 0 ? _c : [],
        },
        controlState: EMPTY_CONTROL_STATE,
        assessments: {},
    };
}
