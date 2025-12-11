export interface ScoringInput {
  orgProfile: {
    industry: string;
    size: "SMB" | "Mid-Market" | "Enterprise";
    aiUsage: string[];
  };
  controls: {
    aiGovernanceDocumented: boolean;
    modelMonitoring: boolean;
    biasTesting: boolean;
    incidentResponseForAI: boolean;
  };
}
