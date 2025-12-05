import { CanonicalControl } from "../../types/v2/Control";
import { NormalizedIntake } from "../../types/v2/Intake";
import { ScoredControl, ScoringResult } from "../../types/v2/Scoring";

export class ScoringEngine {
  static score(controls: CanonicalControl[], intake: NormalizedIntake): ScoringResult {
    const scored = controls.map(c => {
      const impact = c.baselineImpact ?? 1;
      const likelihood = c.baselineLikelihood ?? 1;
      const risk = impact * likelihood;

      return {
        id: c.canonicalId,
        domain: c.canonicalDomain,
        title: c.canonicalTitle,
        impact,
        likelihood,
        risk
      };
    });

    const highestRisk = scored.length ? scored.reduce((a, b) => a.risk > b.risk ? a : b) : null;
    const averageRisk = scored.length ? scored.reduce((sum, x) => sum + x.risk, 0) / scored.length : 0;

    return { scored, highestRisk, averageRisk };
  }
}
