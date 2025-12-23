"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionnaireSchema = void 0;
var zod_1 = require("zod");
exports.QuestionnaireSchema = zod_1.z.object({
    orgProfile: zod_1.z.object({
        industry: zod_1.z.string(),
        size: zod_1.z.enum(["SMB", "Mid-Market", "Enterprise"]),
        aiUsage: zod_1.z.array(zod_1.z.string()),
        modelTypes: zod_1.z.array(zod_1.z.string())
    }),
    governance: zod_1.z.object({
        aiGovernanceDocumented: zod_1.z.boolean(),
        riskOwnerAssigned: zod_1.z.boolean()
    }),
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
            dataRetention: zod_1.z.boolean(),
            secureTrainingPipelines: zod_1.z.boolean()
        }),
        modelDevelopment: zod_1.z.object({
            validationTesting: zod_1.z.boolean(),
            biasTesting: zod_1.z.boolean(),
            robustnessTesting: zod_1.z.boolean(),
            adversarialTesting: zod_1.z.boolean(),
            modelVersioning: zod_1.z.boolean(),
            reproducibility: zod_1.z.boolean()
        }),
        monitoring: zod_1.z.object({
            modelMonitoring: zod_1.z.boolean(),
            driftDetection: zod_1.z.boolean(),
            anomalyDetection: zod_1.z.boolean(),
            incidentPlaybook: zod_1.z.boolean(),
            escalationPath: zod_1.z.boolean(),
            loggingCoverage: zod_1.z.boolean()
        }),
        security: zod_1.z.object({
            accessControls: zod_1.z.boolean(),
            modelRepoSecurity: zod_1.z.boolean(),
            vulnScanning: zod_1.z.boolean(),
            secureInterfaces: zod_1.z.boolean(),
            rateLimiting: zod_1.z.boolean(),
            adversarialDefenses: zod_1.z.boolean()
        }),
        transparency: zod_1.z.object({
            modelCards: zod_1.z.boolean(),
            systemCards: zod_1.z.boolean(),
            auditTrails: zod_1.z.boolean(),
            documentationCompleteness: zod_1.z.boolean(),
            userDisclosure: zod_1.z.boolean(),
            explainabilityMechanisms: zod_1.z.boolean()
        }),
        humanOversight: zod_1.z.object({
            humanInLoop: zod_1.z.boolean(),
            overrideMechanism: zod_1.z.boolean(),
            misusePrevention: zod_1.z.boolean(),
            oversightTraining: zod_1.z.boolean(),
            roleClarity: zod_1.z.boolean()
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
