import { z } from "zod";

export const QuestionnaireSchema = z.object({
  orgProfile: z.object({
    industry: z.string(),
    size: z.enum(["SMB", "Mid-Market", "Enterprise"]),
    aiUsage: z.array(z.string()),
    modelTypes: z.array(z.string())
  }),

  governance: z.object({
    aiGovernanceDocumented: z.boolean(),
    riskOwnerAssigned: z.boolean()
  }),

  controls: z.object({

    governance: z.object({
      aiGovernancePolicy: z.boolean(),
      riskOwnerAssigned: z.boolean(),
      rolesDefined: z.boolean(),
      oversightCommittee: z.boolean(),
      governanceWorkflow: z.boolean()
    }),

    dataQuality: z.object({
      dataLineage: z.boolean(),
      dataQualityChecks: z.boolean(),
      piiManagement: z.boolean(),
      dataRetention: z.boolean(),
      secureTrainingPipelines: z.boolean()
    }),

    modelDevelopment: z.object({
      validationTesting: z.boolean(),
      biasTesting: z.boolean(),
      robustnessTesting: z.boolean(),
      adversarialTesting: z.boolean(),
      modelVersioning: z.boolean(),
      reproducibility: z.boolean()
    }),

    monitoring: z.object({
      modelMonitoring: z.boolean(),
      driftDetection: z.boolean(),
      anomalyDetection: z.boolean(),
      incidentPlaybook: z.boolean(),
      escalationPath: z.boolean(),
      loggingCoverage: z.boolean()
    }),

    security: z.object({
      accessControls: z.boolean(),
      modelRepoSecurity: z.boolean(),
      vulnScanning: z.boolean(),
      secureInterfaces: z.boolean(),
      rateLimiting: z.boolean(),
      adversarialDefenses: z.boolean()
    }),

    transparency: z.object({
      modelCards: z.boolean(),
      systemCards: z.boolean(),
      auditTrails: z.boolean(),
      documentationCompleteness: z.boolean(),
      userDisclosure: z.boolean(),
      explainabilityMechanisms: z.boolean()
    }),

    humanOversight: z.object({
      humanInLoop: z.boolean(),
      overrideMechanism: z.boolean(),
      misusePrevention: z.boolean(),
      oversightTraining: z.boolean(),
      roleClarity: z.boolean()
    }),

    businessContinuity: z.object({
      redundancyInPlace: z.boolean(),
      failoverTested: z.boolean(),
      backupPipelines: z.boolean(),
      disasterRecoveryPlan: z.boolean(),
      rtoDefined: z.boolean(),
      rpoDefined: z.boolean()
    })

  })
});