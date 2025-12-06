import { Rule } from "../RuleEngine";
import { V3ControlInput, Intake, RuleResult } from "../types";

export default class MissingPoliciesRule implements Rule {
  evaluate(control: V3ControlInput, intake: Intake): RuleResult[] {
    const missing = intake?.signals?.missingPolicies ?? [];

    if (!missing.includes(control.id)) {
      return [];
    }

    return [
      {
        passed: false,
        message: `Missing policy for control ${control.id}`,
        deduction: 1
      }
    ];
  }
}