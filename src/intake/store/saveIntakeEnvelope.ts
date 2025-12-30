import fs from "fs";
import path from "path";
import type { IntakeEnvelopeV1 } from "../IntakeEnvelopeV1";

const INTAKE_DIR = path.resolve("intakes");
fs.mkdirSync(INTAKE_DIR, { recursive: true });

export function saveIntakeEnvelope(envelope: IntakeEnvelopeV1) {
  fs.writeFileSync(
    path.join(INTAKE_DIR, `${envelope.runId}.json`),
    JSON.stringify(envelope, null, 2)
  );
}
