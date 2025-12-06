import { Rule } from "../RuleEngine";
import { V3ControlInput, Intake, RuleResult } from "../types";

export default class MissingProceduresRule implements Rule {
  evaluate(control: V3ControlInput, intake: Intake): RuleResult[] {
    const missing = intake?.signals?.missingProcedures ?? [];

    if (!missing.includes(control.id)) {
      return [];
    }

    return [
      {
        passed: false,
        message: `Missing procedures for control ${control.id}`,
        deduction: 1
      }
    ];
  }
}