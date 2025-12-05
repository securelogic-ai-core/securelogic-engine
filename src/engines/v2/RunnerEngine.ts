import { RawFrameworkControl } from "../../types/v2/Control";
import { NormalizedIntake } from "../../types/v2/Intake";

import { ActivationEngine } from "./ActivationEngine";
import { CanonicalizationEngine } from "./CanonicalizationEngine";
import { HarmonizationEngine } from "./HarmonizationEngine";
import { ScoringEngine } from "./ScoringEngine";
import { RoadmapEngine } from "./RoadmapEngine";

export class RunnerEngine {
  static run(intake: NormalizedIntake, catalogInput: any) {

    // 1. Normalize catalog structure
    const catalog: RawFrameworkControl[] =
      Array.isArray(catalogInput)
        ? catalogInput
        : catalogInput.controls ?? [];

    if (!Array.isArray(catalog)) {
      throw new Error("Catalog must resolve to an array.");
    }

    // 2. Activation
    const activated = ActivationEngine.activate(intake, catalog);

    // 3. Canonicalization
    const canonicalized = CanonicalizationEngine.canonicalize(activated);

    // 4. Harmonization
    const harmonized = HarmonizationEngine.harmonize(canonicalized);

    // 5. Scoring
    const scoring = ScoringEngine.score(harmonized, intake);

    // 6. Roadmap
    const roadmap = RoadmapEngine.build(scoring.scored);

    return {
      intake,
      activated,
      canonicalized,
      harmonized,
      scoring,
      roadmap
    };
  }
}
