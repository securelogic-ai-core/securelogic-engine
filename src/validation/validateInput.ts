import Ajv from "ajv";
import schema from "../../schemas/input.schema.json";

const ajv = new Ajv({ allErrors: true });

export function validateInput(input: any) {
  const validate = ajv.compile(schema);

  if (!validate(input)) {
    console.error("❌ INPUT VALIDATION FAILED:");
    console.error(validate.errors);
    throw new Error("Input failed schema validation.");
  }

  return true;
}
