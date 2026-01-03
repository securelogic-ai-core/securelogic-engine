import type { Questionnaire } from "../contracts/Questionnaire.js";
import type { ScoringInput } from "../contracts/ScoringInput.js";

export class ControlMapper {
  static toScoringInput(q: Questionnaire): ScoringInput {
    return {
      orgProfile: q.orgProfile,
      controlState: q.controls,
      assessments: q.assessments ?? {}
    };
  }
}