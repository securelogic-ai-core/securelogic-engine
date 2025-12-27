import { HeatmapScale } from "../contracts/HeatmapScale";
import type { RiskScore } from "../contracts/RiskScore";

export type HeatmapCell = {
  impact: "Low" | "Medium" | "High";
  likelihood: "Low" | "Medium" | "High";
  risks: RiskScore[];
};

export class RiskHeatmapEngine {
  static generate(scores: RiskScore[]): HeatmapCell[] {
    const cells: HeatmapCell[] = [];

    const impacts: HeatmapCell["impact"][] = ["Low", "Medium", "High"];
    const likelihoods: HeatmapCell["likelihood"][] = ["Low", "Medium", "High"];

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
        score.totalRiskScore >= 4 ? "Medium" : "Low";

      const likelihood =
        score.maturityPenalty >= 2 ? "High" :
        score.maturityPenalty === 1 ? "Medium" : "Low";

      const cell = cells.find(
        c => c.impact === impact && c.likelihood === likelihood
      );

      cell?.risks.push(score);
    }

    return cells;
  }
}
