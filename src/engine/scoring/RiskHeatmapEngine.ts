import type { HeatmapScale } from "../contracts/HeatmapScale.js";
import type { RiskScore } from "../contracts/RiskScore.js";

export type HeatmapCell = {
  impact: "Low" | "Moderate" | "High";
  likelihood: "Low" | "Moderate" | "High";
  risks: RiskScore[];
};

export class RiskHeatmapEngine {
  static generate(scores: RiskScore[]): HeatmapCell[] {
    const cells: HeatmapCell[] = [];

    const impacts: HeatmapCell["impact"][] = ["Low", "Moderate", "High"];
    const likelihoods: HeatmapCell["likelihood"][] = ["Low", "Moderate", "High"];

    for (const impact of impacts) {
      for (const likelihood of likelihoods) {
        cells.push({
          impact,
          likelihood,
          risks: []
        });
      }
    }

    for (const score of scores) {
      const impact =
        score.totalRiskScore >= 8 ? "High" :
        score.totalRiskScore >= 4 ? "Moderate" : "Low";

      const likelihood =
        score.maturityPenalty >= 2 ? "High" :
        score.maturityPenalty === 1 ? "Moderate" : "Low";

      const cell = cells.find(
        c => c.impact === impact && c.likelihood === likelihood
      );

      cell?.risks.push(score);
    }

    return cells;
  }
}
