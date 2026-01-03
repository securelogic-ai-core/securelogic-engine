import type { ControlState } from "./ControlState.js";
import type { ControlAssessment } from "./ControlAssessment.js";

export interface ScoringInput {
  orgProfile: {
    industry: string;
    size: "SMB" | "Mid-Market" | "Enterprise";
    aiUsage: string[];
    modelTypes: string[];
  };

  controlState: ControlState;

  assessments: Record<string, ControlAssessment>;
}
