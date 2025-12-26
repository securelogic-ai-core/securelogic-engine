import Ajv from "ajv";
import schema from "../schema/ResultEnvelopeV1.schema.json";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

export function validateResultEnvelope(input: unknown): void {
  if (!validate(input)) {
    throw new Error(
      "Invalid ResultEnvelopeV1: " + ajv.errorsText(validate.errors)
    );
  }
}
