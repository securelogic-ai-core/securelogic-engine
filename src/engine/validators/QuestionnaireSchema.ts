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
    modelMonitoring: z.boolean(),
    biasTesting: z.boolean(),
    incidentResponseForAI: z.boolean(),
    inventoryMaintained: z.boolean()
  })
});
