import { ControlRegistry } from "../registry/ControlRegistry.js";
import type { ControlAssessment } from "../contracts/ControlAssessment.js";
import type { ControlState } from "../contracts/ControlState.js";

type AnyObject = Record<string, unknown>;

export class AssessmentInferenceEngine {
  static infer(controlState: ControlState): ControlAssessment[] {
    const state = controlState as unknown as AnyObject;

    return Object.entries(ControlRegistry.controls).map(
      ([path, definition]) => {
        const parts = path.split(".");
        const domain = parts[0];
        const control = parts[1];

        let observed = false;

        if (domain && control) {
          const domainObj = state[domain];
          if (typeof domainObj === "object" && domainObj !== null) {
            observed = (domainObj as AnyObject)[control] === true;
          }
        }

        return {
          controlId: definition.id,
          controlPath: path,
          satisfied: observed,
          implemented: observed,
          maturityLevel: observed ? 3 : 1,
          evidenceProvided: observed,
          riskAccepted: false
        };
      }
    );
  }
}
