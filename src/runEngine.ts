import fs from "fs";
import { validateInput } from "./validation/validateInput";

import { ActivationEngine } from "./engines/v2/ActivationEngine";
import { CanonicalizationEngine } from "./engines/v2/CanonicalizationEngine";
import { HarmonizationEngine } from "./engines/v2/HarmonizationEngine";
import { ScoringEngine } from "./engines/v2/ScoringEngine";
import { RoadmapEngine } from "./engines/v2/RoadmapEngine";

import { loadCatalogFiles } from "./utils/loadCatalogFiles";

function run() {
  const intakePath = process.argv[2];
  const catalogPath = process.argv[3];

  if (!intakePath || !catalogPath) {
    console.error("Usage: node dist/runEngine.js <input.json> <catalog.json>");
    process.exit(1);
  }

  const intakeJson = JSON.parse(fs.readFileSync(intakePath, "utf8"));
  validateInput(intakeJson);

  const catalog = loadCatalogFiles([catalogPath]);

  const activated = ActivationEngine.activate(intakeJson, catalog);
  const canonicalized = CanonicalizationEngine.canonicalize(activated);
  const harmonized = HarmonizationEngine.harmonize(canonicalized);
  const scoring = ScoringEngine.score(harmonized, intakeJson);
  const roadmap = RoadmapEngine.build(scoring.scored);

  console.log(JSON.stringify({
    intake: intakeJson,
    activated,
    canonicalized,
    harmonized,
    scoring,
    roadmap
  }, null, 2));
}

run();
