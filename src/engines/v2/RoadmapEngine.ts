import { ScoredControl } from "../../types/v2/Scoring";
import { RoadmapItem, RoadmapResult } from "../../types/v2/Roadmap";

export class RoadmapEngine {

  static build(scored: ScoredControl[]): RoadmapResult {

    const sorted = [...scored].sort((a, b) => b.risk - a.risk);

    const items: RoadmapItem[] = sorted.map((control, index) => ({
      id: control.id,
      title: control.title,
      priority: index + 1
    }));

    return { items };
  }

}
