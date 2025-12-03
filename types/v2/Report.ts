import { HarmonizedGroup } from "./Harmonization";
import { ScoringResult } from "./Scoring";
import { HeatmapResult } from "./Heatmap";
import { ThreatModelResult } from "./ThreatModel";
import { RoadmapResult } from "./Roadmap";

export interface FinalReport {
  intakeSummary: any;
  harmonized: HarmonizedGroup[];
  scoring: ScoringResult;
  heatmap: HeatmapResult;
  threats: ThreatModelResult;
  roadmap: RoadmapResult;
}
