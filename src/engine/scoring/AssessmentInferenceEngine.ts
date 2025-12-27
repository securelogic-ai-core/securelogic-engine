import { ControlRegistry } from "../registry/ControlRegistry";
import type { ControlAssessment } from "../contracts/ControlAssessment";
import type { ControlState } from "../contracts/ControlState";

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
