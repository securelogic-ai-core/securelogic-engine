export interface ControlState {
  governance: {
    aiGovernancePolicy: boolean;
    riskOwnerAssigned: boolean;
    rolesDefined: boolean;
    oversightCommittee: boolean;
    governanceWorkflow: boolean;
  };

  dataQuality: {
    dataLineage: boolean;
    dataQualityChecks: boolean;
    piiManagement: boolean;
    dataRetention: boolean;
  };

  modelDevelopment: {
    validationTesting: boolean;
    biasTesting: boolean;
    modelApproval: boolean;
  };

  monitoring: {
    driftDetection: boolean;
    incidentResponse: boolean;
  };

  security: {
    modelRepoSecurity: boolean;
    adversarialDefenses: boolean;
    vulnScanning: boolean;
  };

  businessContinuity: {
    backupTesting: boolean;
    recoveryPlan: boolean;
  };

  humanOversight: {
    humanInLoop: boolean;
  };
}