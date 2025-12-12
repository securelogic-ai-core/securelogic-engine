export const ControlRegistry = {
  governance: {
    aiGovernancePolicy: { id: "GOV-001", frameworks: ["ISO 42001"] },
    riskOwnerAssigned: { id: "GOV-002", frameworks: ["ISO 42001"] },
    rolesDefined: { id: "GOV-003", frameworks: ["ISO 42001"] },
    oversightCommittee: { id: "GOV-004", frameworks: ["ISO 42001"] },
    governanceWorkflow: { id: "GOV-005", frameworks: ["ISO 42001"] }
  },

  dataQuality: {
    dataLineage: { id: "DQ-001", frameworks: ["ISO 42001"] },
    dataQualityChecks: { id: "DQ-002", frameworks: ["ISO 42001"] },
    piiManagement: { id: "DQ-003", frameworks: ["GDPR"] },
    dataRetention: { id: "DQ-004", frameworks: ["GDPR"] },
    secureTrainingPipelines: { id: "DQ-005", frameworks: ["ISO 42001"] }
  },

  modelDevelopment: {
    validationTesting: { id: "MD-001", frameworks: ["NIST AI RMF"] },
    biasTesting: { id: "MD-002", frameworks: ["NIST AI RMF"] },
    robustnessTesting: { id: "MD-003", frameworks: ["NIST AI RMF"] },
    adversarialTesting: { id: "MD-004", frameworks: ["NIST AI RMF"] },
    modelVersioning: { id: "MD-005", frameworks: ["ISO 42001"] },
    reproducibility: { id: "MD-006", frameworks: ["ISO 42001"] }
  },

  monitoring: {
    modelMonitoring: { id: "MON-001", frameworks: ["NIST AI RMF"] },
    driftDetection: { id: "MON-002", frameworks: ["NIST AI RMF"] },
    anomalyDetection: { id: "MON-003", frameworks: ["ISO 42001"] },
    incidentPlaybook: { id: "MON-004", frameworks: ["ISO 42001"] },
    escalationPath: { id: "MON-005", frameworks: ["ISO 42001"] },
    loggingCoverage: { id: "MON-006", frameworks: ["SOC 2"] }
  },

  security: {
    accessControls: { id: "SEC-001", frameworks: ["SOC 2"] },
    modelRepoSecurity: { id: "SEC-002", frameworks: ["ISO 42001"] },
    vulnScanning: { id: "SEC-003", frameworks: ["SOC 2"] },
    secureInterfaces: { id: "SEC-004", frameworks: ["SOC 2"] },
    rateLimiting: { id: "SEC-005", frameworks: ["ISO 42001"] },
    adversarialDefenses: { id: "SEC-006", frameworks: ["NIST AI RMF"] }
  },

  transparency: {
    modelCards: { id: "TRAN-001", frameworks: ["ISO 42001"] },
    systemCards: { id: "TRAN-002", frameworks: ["ISO 42001"] },
    auditTrails: { id: "TRAN-003", frameworks: ["SOC 2"] },
    documentationCompleteness: { id: "TRAN-004", frameworks: ["ISO 42001"] },
    userDisclosure: { id: "TRAN-005", frameworks: ["ISO 42001"] },
    explainabilityMechanisms: { id: "TRAN-006", frameworks: ["NIST AI RMF"] }
  },

  humanOversight: {
    humanInLoop: { id: "HO-001", frameworks: ["ISO 42001"] },
    overrideMechanism: { id: "HO-002", frameworks: ["ISO 42001"] },
    misusePrevention: { id: "HO-003", frameworks: ["ISO 42001"] },
    oversightTraining: { id: "HO-004", frameworks: ["ISO 42001"] },
    roleClarity: { id: "HO-005", frameworks: ["ISO 42001"] }
  },

  businessContinuity: {
    redundancyInPlace: { id: "BC-001", frameworks: ["SOC 2"] },
    failoverTested: { id: "BC-002", frameworks: ["SOC 2"] },
    backupPipelines: { id: "BC-003", frameworks: ["SOC 2"] },
    disasterRecoveryPlan: { id: "BC-004", frameworks: ["SOC 2"] },
    rtoDefined: { id: "BC-005", frameworks: ["SOC 2"] },
    rpoDefined: { id: "BC-006", frameworks: ["SOC 2"] }
  }
};
