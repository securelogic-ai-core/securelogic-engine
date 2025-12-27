import type { Questionnaire } from "../contracts/Questionnaire";
import type { ScoringInput } from "../contracts/ScoringInput";
import { ControlMapper } from "./ControlMapper";

export function mapToScoringInput(q: Questionnaire): ScoringInput {
  return ControlMapper.toScoringInput(q);
}
