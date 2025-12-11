import { Questionnaire } from "../contracts/Questionnaire";
import { QuestionnaireSchema } from "../validators/QuestionnaireSchema";

export function normalizeQuestionnaire(raw: any): Questionnaire {
  const parsed = QuestionnaireSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      "Invalid questionnaire input: " +
        JSON.stringify(parsed.error.format(), null, 2)
    );
  }

  return parsed.data;
}
