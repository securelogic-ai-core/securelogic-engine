export interface RawIntakeSubmission {
  size?: string;
  triggers?: string[];
  frameworks?: string[];
  domains?: string[];
  controlIds?: string[];
}

export interface NormalizedIntake {
  signals?: {
    missingPolicies?: string[];
    riskIndicators?: string[];
    foundControls?: string[];
  };

  size: string;
  triggers: string[];
  frameworks: string[];
  domains: string[];
  controlIds: string[];
}
