import type { ControlState } from "../contracts/ControlState";

/**
 * Canonical enterprise initial control state.
 * Fully aligned with locked ControlState contract.
 */
export function buildInitialControlState(): ControlState {
  return {
    governance: {
      aiGovernancePolicy: false,
      riskOwnerAssigned: false,
      rolesDefined: false,
      oversightCommittee: false,
      governanceWorkflow: false
    },

    dataQuality: {
      dataLineage: false,
      dataQualityChecks: false,
      piiManagement: false,
      dataRetention: false
    },

    modelDevelopment: {
      validationTesting: false,
      biasTesting: false,
      modelApproval: false
    },

    monitoring: {
      driftDetection: false,
      incidentResponse: false
    },

    security: {
      modelRepoSecurity: false,
      adversarialDefenses: false,
      vulnScanning: false
    },

    businessContinuity: {
      backupTesting: false,
      recoveryPlan: false
    },

    humanOversight: {
      humanInLoop: false
    }
  };
}
