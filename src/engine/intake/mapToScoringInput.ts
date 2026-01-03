import type { Questionnaire } from "../contracts/Questionnaire.js";
import type { ScoringInput } from "../contracts/ScoringInput.js";
import { ControlMapper } from "./ControlMapper.js";

export function mapToScoringInput(q: Questionnaire): ScoringInput {
  return ControlMapper.toScoringInput(q);
}
