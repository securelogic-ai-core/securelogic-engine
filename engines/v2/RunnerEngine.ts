import { RawIntakeSubmission } from "../../types/v2/Intake";
import catalog from "../../data/controlCatalog.json";

import { IntakeEngine } from "./IntakeEngine";
import { ActivationEngine } from "./ActivationEngine";
import { CanonicalizationEngine } from "./CanonicalizationEngine";
import { HarmonizationEngine } from "./HarmonizationEngine";
import { ScoringEngine } from "./ScoringEngine";
import { HeatmapEngine } from "./HeatmapEngine";
import { ThreatModelEngine } from "./ThreatModelEngine";
import { RoadmapEngine } from "./RoadmapEngine";
import { ReportAssemblyEngine } from "./ReportAssemblyEngine";

/**
 * RunnerEngine (v2)
 * The ONLY canonical pipeline.
 */
export class RunnerEngine {

  static execute(raw: RawIntakeSubmission) {

    const intake = IntakeEngine.normalize(raw);

    const activated = ActivationEngine.activate(intake as any, catalog as any);

    const canonical = CanonicalizationEngine.canonicalize(activated as any);

    const harmonized = HarmonizationEngine.harmonize(canonical);

    const scoring = ScoringEngine.score(harmonized);

    const heatmap = HeatmapEngine.build(scoring);

    const threats = ThreatModelEngine.build(scoring);

    const roadmap = RoadmapEngine.build(scoring);

    return ReportAssemblyEngine.build({
      harmonized,
      scoring,
      heatmap,
      threats,
      roadmap
    });
  }
}
