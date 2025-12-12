import { z } from "zod";

export const QuestionnaireSchema = z.object({
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
      dataRetention: z.boolean()
    }),

    modelDevelopment: z.object({
      validationTesting: z.boolean(),
      biasTesting: z.boolean(),
      modelApproval: z.boolean()
    }),

    monitoring: z.object({
      driftDetection: z.boolean(),
      incidentResponse: z.boolean()
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

export type QuestionnaireInput = z.infer<typeof QuestionnaireSchema>;
