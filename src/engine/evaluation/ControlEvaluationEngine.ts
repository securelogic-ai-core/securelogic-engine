import type { ControlDefinition } from "../contracts/ControlDefinition.js";
import { ControlRegistry } from "../registry/ControlRegistry.js";

export type ControlResult = {
  framework: string;
  control: ControlDefinition;
  passed: boolean;
  __explain?: {
    decision: {
      rule: string;
      controlId: string;
      inputValue: boolean | undefined;
      passed: boolean;
    };
  };
};

const EXPLAIN_MODE = process.env.SECURELOGIC_EXPLAIN === "1";

export class ControlEvaluationEngine {
  static evaluate(
    answers: Record<string, boolean>
  ): ControlResult[] {
    const results: ControlResult[] = [];

    for (const [framework, controls] of Object.entries(ControlRegistry.byFramework)) {
      for (const control of controls) {
        const inputValue = answers[control.id];
        const passed = inputValue === true;

        const result: ControlResult = {
          framework,
          control,
          passed
        };

        // Hidden explain block (does not affect prod outputs)
        if (EXPLAIN_MODE) {
          result.__explain = {
            decision: {
              rule: "answer === true",
              controlId: control.id,
              inputValue,
              passed
            }
          };
        }

        results.push(result);
      }
    }

    return results;
  }
}
