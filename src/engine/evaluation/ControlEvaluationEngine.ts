import type { ControlDefinition } from "../contracts/ControlDefinition.js";
import { ControlRegistry } from "../registry/ControlRegistry.js";

export type ControlResult = {
  framework: string;
  control: ControlDefinition;
  passed: boolean;
};

export class ControlEvaluationEngine {
  static evaluate(
    answers: Record<string, boolean>
  ): ControlResult[] {
    const results: ControlResult[] = [];

    for (const [framework, controls] of Object.entries(ControlRegistry.byFramework)) {
      for (const control of controls) {
        results.push({
          framework,
          control,
          passed: answers[control.id] === true
        });
      }
    }

    return results;
  }
}