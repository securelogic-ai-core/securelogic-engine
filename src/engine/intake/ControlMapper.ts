import { Questionnaire } from "../contracts/Questionnaire";
import { ScoringInput } from "../contracts/ScoringInput";

export class ControlMapper {
  static toScoringInput(q: Questionnaire): ScoringInput {
    return {
      orgProfile: q.orgProfile,
      controlState: q.controls,
      assessments: q.assessments ?? {}
    };
  }
}