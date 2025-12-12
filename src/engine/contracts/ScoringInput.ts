import { ControlState } from "./ControlState";
import { ControlAssessment } from "./ControlAssessment";

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
