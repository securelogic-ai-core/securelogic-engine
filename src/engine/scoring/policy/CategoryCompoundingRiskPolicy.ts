import type { RiskFinding } from "../../contracts/RiskFinding.js";
import type { RiskLevel } from "../../contracts/RiskLevel.js";

export class CategoryCompoundingRiskPolicy {
  static apply(findings: RiskFinding[]): RiskFinding[] {
    const categoryMap = new Map<string, RiskLevel>();

    for (const f of findings) {
      const existing = categoryMap.get(f.domain);
      if (!existing || this.compare(f.level, existing) > 0) {
        categoryMap.set(f.domain, f.level);
      }
    }

    return findings;
  }

  private static compare(a: RiskLevel, b: RiskLevel): number {
    const order: RiskLevel[] = ["Low", "Moderate", "High", "Critical"];
    return order.indexOf(a) - order.indexOf(b);
  }
}
