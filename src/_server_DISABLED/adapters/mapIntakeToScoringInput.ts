import type { UnifiedRiskObject } from "../../domain/core/URO";
import type { ScoringInput } from "../../engine/contracts/ScoringInput";
import type { ControlState } from "../../engine/contracts/ControlState";

type OrgProfile = {
  industry: string;
  size: "SMB" | "Mid-Market" | "Enterprise";
  aiUsage?: string[];
  modelTypes?: string[];
};

const EMPTY_CONTROL_STATE: ControlState = {
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

export function mapIntakeToScoringInput(
  uro: UnifiedRiskObject
): ScoringInput {
  const org = uro.metadata?.orgProfile as OrgProfile | undefined;

  if (!org) {
    throw new Error("Missing orgProfile in intake metadata");
  }

  return {
    orgProfile: {
      industry: org.industry,
      size: org.size,
      aiUsage: org.aiUsage ?? [],
      modelTypes: org.modelTypes ?? [],
    },

    controlState: EMPTY_CONTROL_STATE,

    assessments: {},
  };
}
