import type { Questionnaire } from "../contracts/Questionnaire";

export function normalizeQuestionnaire(parsed: any): Questionnaire {
  return {
    orgProfile: parsed.data.orgProfile,
    controls: parsed.data.controls,
    assessments: {}
  };
}
