import { ControlState } from "./ControlState";
import { ControlAssessment } from "./ControlAssessment";

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
