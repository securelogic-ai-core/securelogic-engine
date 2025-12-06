import { V3ControlInput, Intake, ScoredControl } from "./types";
import RuleEngine from "./RuleEngine";
import MissingEvidenceRule from "./rules/MissingEvidenceRule";
import MissingPoliciesRule from "./rules/MissingPoliciesRule";
import MissingProceduresRule from "./rules/MissingProceduresRule";

export class ScoringEngineV3 {
  private ruleEngine: RuleEngine;

  constructor() {
    this.ruleEngine = new RuleEngine([
      new MissingEvidenceRule(),
      new MissingPoliciesRule(),
      new MissingProceduresRule()
    ]);
  }

  score(controls: V3ControlInput[], intake: Intake): ScoredControl[] {
    return controls.map((ctrl) => {
      const findings = this.ruleEngine.evaluate(ctrl, intake);

      let risk = ctrl.impact + ctrl.likelihood;

      findings.forEach((f) => {
        if (f.deduction && f.deduction > 0) {
          risk += f.deduction;
        }
      });

      return {
        id: ctrl.id,
        title: ctrl.title,
        domain: ctrl.domain,
        impact: ctrl.impact,
        likelihood: ctrl.likelihood,
        risk,
        findings
      };
    });
  }
}

export default ScoringEngineV3;
