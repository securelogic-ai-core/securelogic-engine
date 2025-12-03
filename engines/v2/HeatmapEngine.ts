import { ScoringResult } from "../../types/v2/Scoring";
import { HeatmapCell, HeatmapMatrix, HeatmapResult } from "../../types/v2/Heatmap";

/**
 * HeatmapEngine (v2)
 *
 * Converts ScoringResult into a deterministic 5x5 matrix.
 * Matrix indexes: [impact][likelihood]
 */
export class HeatmapEngine {

  static build(scoring: ScoringResult): HeatmapResult {

    // 5x5 grid initialized to zero
    const matrix: HeatmapMatrix = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, (): HeatmapCell => ({ count: 0 }))
    );

    // Populate the matrix
    for (const s of scoring.scored) {
      const i = Math.min(Math.max(s.impact, 1), 5) - 1;
      const l = Math.min(Math.max(s.likelihood, 1), 5) - 1;
      matrix[i][l].count += 1;
    }

    // Determine the highest cell value for summary purposes
    let highestCell = 0;
    for (const row of matrix) {
      for (const cell of row) {
        if (cell.count > highestCell) highestCell = cell.count;
      }
    }

    return {
      matrix,
      highestCell
    };
  }

}
