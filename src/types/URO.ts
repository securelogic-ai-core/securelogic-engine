export interface UnifiedRiskObject {
  size: "small" | "medium" | "large";
  triggers: string[];
  _version: "1.0.0";

  system: {
    name: string;
    description: string;
    owner: string;
    criticality: "low" | "medium" | "high" | "mission_critical";
    lifecycleStage: "design" | "development" | "deployment" | "monitoring";
  };

  metadata: {
    industry: string;
    jurisdiction: string[];
    vendorTier: "tier1" | "tier2" | "tier3" | "internal";
    dataTypes: string[];
    deploymentModel: "saas" | "onprem" | "hybrid" | "unknown";
  };

  structuredAnswers: {
    [key: string]: string | number | boolean;
  };

  documents?: {
    name: string;
    type: string;
    content: string;
    extractedText?: string | null;
  }[];

  signals?: {
    missingPolicies?: string[];
    foundControls?: string[];
    gapsDetected?: string[];
    riskIndicators?: string[];
  };

  overrides?: {
    enableControls?: string[];
    disableControls?: string[];
    adjustLikelihood?: Record<string, number>;
    adjustImpact?: Record<string, number>;
  };

  engineVersion: string;
  ingestionNotes?: string[];
}
