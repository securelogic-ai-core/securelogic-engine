import Ajv from "ajv";
import schema from "../schema/evidence-record.v1.json";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

export function validateEvidenceRecord(input: unknown) {
  const valid = validate(input);
  if (!valid) {
    throw new Error(
      "INVALID_EVIDENCE_RECORD: " +
        JSON.stringify(validate.errors, null, 2)
    );
  }
}
