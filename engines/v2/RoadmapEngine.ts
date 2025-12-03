import { ScoringResult, ScoredControl } from "../../types/v2/Scoring";
import { RoadmapItem, RoadmapResult } from "../../types/v2/Roadmap";

/**
 * RoadmapEngine (v2)
 *
 * Deterministic remediation roadmap.
 * No AI-generated text. No randomization.
 * Fully rules-based with stable scoring logic.
 */
export class RoadmapEngine {

  static build(scoring: ScoringResult): RoadmapResult {
    const items = scoring.scored.map(s => this.toRoadmapItem(s));
    return { items };
  }

  private static toRoadmapItem(s: ScoredControl): RoadmapItem {
    return {
      controlId: s.controlId,
      title: s.title,
      currentMaturity: this.mapCurrentMaturity(s),
      targetMaturity: 5,
      priority: this.mapPriority(s),
      recommendation: this.mapRecommendation(s)
    };
  }

  private static mapCurrentMaturity(s: ScoredControl): number {
    // Simple deterministic mapping
    const risk = s.risk;
    if (risk >= 15) return 1;
    if (risk >= 10) return 2;
    if (risk >= 6)  return 3;
    if (risk >= 3)  return 4;
    return 5;
  }

  private static mapPriority(s: ScoredControl): number {
    // Lower number = higher priority
    const risk = s.risk;
    if (risk >= 15) return 1; // Critical
    if (risk >= 10) return 2; // High
    if (risk >= 6)  return 3; // Medium
    if (risk >= 3)  return 4; // Low
    return 5;                // Minimal
  }

  private static mapRecommendation(s: ScoredControl): string {
    const priority = this.mapPriority(s);

    switch (priority) {
      case 1:
        return `Critical: ${s.title} must be addressed in the immediate sprint.`;
      case 2:
        return `High: Remediate ${s.title} in the next scheduled sprint window.`;
      case 3:
        return `Medium: Address ${s.title} during the next quarterly cycle.`;
      case 4:
        return `Low: Improve ${s.title} during standard review cycles.`;
      default:
        return `Monitor: ${s.title} requires no immediate remediation.`;
    }
  }

}
