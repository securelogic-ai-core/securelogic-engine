export interface RawIntakeSubmission {
  size?: string;
  triggers?: string[];
  frameworks?: string[];
  domains?: string[];
  controlIds?: string[];
}

export interface NormalizedIntake {
  size: string;
  triggers: string[];
  frameworks: string[];
  domains: string[];
  controlIds: string[];
}
