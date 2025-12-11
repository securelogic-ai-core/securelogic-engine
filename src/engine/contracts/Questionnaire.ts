export interface Questionnaire {
  orgProfile: {
    industry: string;
    size: "SMB" | "Mid-Market" | "Enterprise";
    aiUsage: string[];
    modelTypes: string[];
  };

  governance: {
    aiGovernanceDocumented: boolean;
    riskOwnerAssigned: boolean;
  };

  controls: {
    modelMonitoring: boolean;
    biasTesting: boolean;
    incidentResponseForAI: boolean;
    inventoryMaintained: boolean;
  };
}
