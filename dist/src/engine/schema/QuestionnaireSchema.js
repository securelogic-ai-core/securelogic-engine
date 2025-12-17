"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionnaireSchema = void 0;
const zod_1 = require("zod");
exports.QuestionnaireSchema = zod_1.z.object({
    controls: zod_1.z.object({
        governance: zod_1.z.object({
            aiGovernancePolicy: zod_1.z.boolean(),
            riskOwnerAssigned: zod_1.z.boolean(),
            rolesDefined: zod_1.z.boolean(),
            oversightCommittee: zod_1.z.boolean(),
            governanceWorkflow: zod_1.z.boolean()
        }),
        dataQuality: zod_1.z.object({
            dataLineage: zod_1.z.boolean(),
            dataQualityChecks: zod_1.z.boolean(),
            piiManagement: zod_1.z.boolean(),
            dataRetention: zod_1.z.boolean()
        }),
        modelDevelopment: zod_1.z.object({
            validationTesting: zod_1.z.boolean(),
            biasTesting: zod_1.z.boolean(),
            modelApproval: zod_1.z.boolean()
        }),
        monitoring: zod_1.z.object({
            driftDetection: zod_1.z.boolean(),
            incidentResponse: zod_1.z.boolean()
        }),
        businessContinuity: zod_1.z.object({
            redundancyInPlace: zod_1.z.boolean(),
            failoverTested: zod_1.z.boolean(),
            backupPipelines: zod_1.z.boolean(),
            disasterRecoveryPlan: zod_1.z.boolean(),
            rtoDefined: zod_1.z.boolean(),
            rpoDefined: zod_1.z.boolean()
        })
    })
});
