import { RiskSeverity } from "../contracts/RiskSeverity";
import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";

export type MaterialRisk = {
  id: string;
  title: string;
  category: string;
  contributionPercent: number;
  whyItMatters: string;
};

export type MaterialityResult = {
  overallRating: RiskSeverity;
  materialRisks: MaterialRisk[];
  rationale: string[];
};

export class MaterialityEngine {
  static evaluate(
    enterprise: EnterpriseRiskSummary
  ): MaterialityResult {

    const total = enterprise.overallScore;

    const risks: MaterialRisk[] = enterprise.categoryScores
      .map((c) => {
        const contribution = (c.score / total) * 100;

        return {
          id: `MR-${c.category.toUpperCase()}`,
          title: `${c.category} AI Risk`,
          category: c.category,
          severity: c.severity,
          contributionPercent: Number(contribution.toFixed(1)),
          whyItMatters: this.translateCategory(c.category)
        };
      })
      .filter(r => r.contributionPercent >= 10 || r.category === "Governance")
      .filter(r => r.severity !== "Low")
      .sort((a, b) => b.contributionPercent - a.contributionPercent)
      .slice(0, 5);

    const overallRating =
      enterprise.severity === "High"
        ? "High"
        : enterprise.severity === "Moderate"
        ? "Moderate"
        : "Low";

    return {
      overallRating,
      materialRisks: risks,
      rationale: enterprise.severityRationale
    };
  }

  private static translateCategory(category: string): string {
    switch (category) {
      case "Governance":
        return "Lack of AI governance increases regulatory, legal, and reputational exposure.";
      case "Monitoring":
        return "Insufficient model monitoring increases the likelihood of undetected failures and bias.";
      case "Business Continuity":
        return "AI system outages may disrupt critical operations and recovery capabilities.";
      default:
        return "Unmanaged AI risk may negatively impact business objectives.";
    }
  }
}
