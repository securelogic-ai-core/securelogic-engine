import type { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary.js";
import type { RiskSeverity} from "../../contracts/RiskSeverity.js";
import { RISK_SEVERITY } from "../../contracts/RiskSeverity.js";

const MATERIALITY_THRESHOLDS: Record<string, number> = {
  Governance: 0.30,
  Monitoring: 0.25,
  "Business Continuity": 0.20
};

export class CategoryMaterialityPolicy {
  static apply(summary: EnterpriseRiskSummary): EnterpriseRiskSummary {
    if (summary.severity !== "High") {
      return summary;
    }

    const categoryScores = summary.categoryScores.map(category => {
      const threshold = MATERIALITY_THRESHOLDS[category.category];
      if (!threshold) return category;

      const share = category.score / summary.overallScore;

      if (share >= threshold) {
        return {
          ...category,
          severity: "High" as RiskSeverity
        };
      }

      return category;
    });

    return {
      ...summary,
      categoryScores
    };
  }
}
