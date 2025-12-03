export interface RawIntakeSubmission {
  triggers: string[];
  frameworks?: string[];
  domains?: string[];
  controlIds?: string[];
  size?: "small" | "medium" | "large";
  industry?: string;
}

export interface NormalizedIntake {
  triggers: string[];
  frameworks: string[];
  domains: string[];
  controlIds: string[];
  size: "small" | "medium" | "large";
  industry?: string;
}

export interface IntakeFilters {
  frameworks: string[];
  domains: string[];
  controlIds: string[];
}
