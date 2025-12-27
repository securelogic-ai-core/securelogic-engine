import type { Questionnaire } from "../contracts/Questionnaire";
import type { ScoringInput } from "../contracts/ScoringInput";

export class ControlMapper {
  static toScoringInput(q: Questionnaire): ScoringInput {
    return {
      orgProfile: q.orgProfile,
      controlState: q.controls,
      assessments: q.assessments ?? {}
    };
  }
}