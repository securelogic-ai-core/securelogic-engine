import { Questionnaire } from "../contracts/Questionnaire";
import { ScoringInput } from "../contracts/ScoringInput";

export function mapToScoringInput(q: Questionnaire): ScoringInput {
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
