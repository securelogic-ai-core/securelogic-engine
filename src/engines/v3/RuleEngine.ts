import { V3ControlInput, Intake, RuleResult } from "./types";

export interface Rule {
  evaluate(control: V3ControlInput, intake: Intake): RuleResult[];
}

export default class RuleEngine {
  private rules: Rule[];

  constructor(rules: Rule[]) {
    this.rules = rules;
  }

  evaluate(control: V3ControlInput, intake: Intake): RuleResult[] {
    let results: RuleResult[] = [];
    for (const rule of this.rules) {
      const ruleResults = rule.evaluate(control, intake);
      results = results.concat(ruleResults);
    }
    return results;
  }
}
