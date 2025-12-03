import { HarmonizedGroup } from "./Harmonization";
import { ScoringResult } from "./Scoring";
import { ThreatModelResult } from "./ThreatModel";
import { HeatmapResult } from "./Heatmap";
import { RoadmapItem } from "./Roadmap";

export interface FinalReport {
  metadata: any;
  harmonization: HarmonizedGroup[];
  scoring: ScoringResult;
  heatmap: HeatmapResult;
  threatModel: ThreatModelResult;
  roadmap: RoadmapItem[];
  summary: any;
}
