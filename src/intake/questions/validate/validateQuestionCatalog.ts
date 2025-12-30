import Ajv from "ajv";
import schema from "../schema/question-catalog.v1.json";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

export function validateQuestionCatalog(input: unknown) {
  const valid = validate(input);
  if (!valid) {
    throw new Error(
      "INVALID_QUESTION_CATALOG: " +
        JSON.stringify(validate.errors, null, 2)
    );
  }
}
