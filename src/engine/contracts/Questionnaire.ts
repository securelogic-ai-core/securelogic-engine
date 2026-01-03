import type { ControlState } from "./ControlState.js";
import type { ControlAssessment } from "./ControlAssessment.js";

export interface Questionnaire {
  orgProfile: {
    industry: string;
    size: "SMB" | "Mid-Market" | "Enterprise";
    aiUsage: string[];
    modelTypes: string[];
  };

  controls: ControlState;

  assessments: Record<string, ControlAssessment>;
}
