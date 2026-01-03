import { ControlRegistry } from "../registry/ControlRegistry.js";
import type { ControlAssessment } from "../contracts/ControlAssessment.js";
import type { ControlState } from "../contracts/ControlState.js";

export class AssessmentInferenceEngine {
  static infer(controlState: ControlState): ControlAssessment[] {
    return Object.entries(ControlRegistry.controls).map(
      ([path, definition]) => {
        const [domain, control] = path.split(".");
        const observed =
          (controlState as any)[domain]?.[control] === true;

        return {
  controlId: definition.id,
  controlPath: path,
  satisfied: observed,
  implemented: observed,
  maturityLevel: observed ? 3 : 1,
  evidenceProvided: observed,
  riskAccepted: false
}
      }
    );
  }
}
