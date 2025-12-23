import { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";

const COMPOUNDING_RULES = [
  {
    categories: ["Governance", "Monitoring"],
    minSeverity: "Moderate",
    escalateTo: "High",
    rationale: "Governance and Monitoring weaknesses compound systemic AI risk"
  },
  {
    categories: ["Governance", "Business Continuity"],
    minSeverity: "Moderate",
    escalateTo: "High",
    rationale: "Governance and resilience gaps create compounding operational risk"
  }
];

export class CategoryCompoundingRiskPolicy {
  static apply(summary: EnterpriseRiskSummary): EnterpriseRiskSummary {
    const categoryMap = new Map(
      summary.categoryScores.map(c => [c.category, c.severity])
    );

    const rationales: string[] = [];

    for (const rule of COMPOUNDING_RULES) {
      const [a, b] = rule.categories;
      const sevA = categoryMap.get(a);
      const sevB = categoryMap.get(b);

      if (!sevA || !sevB) continue;

      const qualifies =
        (sevA === "High" || sevA === rule.minSeverity) &&
        (sevB === "High" || sevB === rule.minSeverity);

      if (qualifies) {
        rationales.push(rule.rationale);
      }
    }

    if (rationales.length === 0) {
      return summary;
    }

    return {
      ...summary,
      severityRationale: [
        ...(summary.severityRationale ?? []),
        ...rationales
      ]
    };
  }
}