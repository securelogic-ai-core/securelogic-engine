import { Rule } from "../RuleEngine";
import { V3ControlInput, Intake, RuleResult } from "../types";

export default class MissingEvidenceRule implements Rule {
  evaluate(control: V3ControlInput, intake: Intake): RuleResult[] {
    const missing = intake?.signals?.missingEvidence ?? [];

    if (!missing.includes(control.id)) {
      return [];
    }

    return [
      {
        passed: false,
        message: `Missing evidence for control ${control.id}`,
        deduction: 1
      }
    ];
  }
}