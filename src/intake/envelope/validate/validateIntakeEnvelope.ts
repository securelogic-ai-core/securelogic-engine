import Ajv from "ajv";
import schema from "../schema/intake-envelope.v1.json";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

export function validateIntakeEnvelope(input: unknown) {
  const valid = validate(input);
  if (!valid) {
    throw new Error(
      "INVALID_INTAKE_ENVELOPE: " +
        JSON.stringify(validate.errors, null, 2)
    );
  }
}
