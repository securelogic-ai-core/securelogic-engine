"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const validateInput_1 = require("./validation/validateInput");
const ActivationEngine_1 = require("./engines/v2/ActivationEngine");
const CanonicalizationEngine_1 = require("./engines/v2/CanonicalizationEngine");
const HarmonizationEngine_1 = require("./engines/v2/HarmonizationEngine");
const ScoringEngine_1 = require("./engines/v2/ScoringEngine");
const RoadmapEngine_1 = require("./engines/v2/RoadmapEngine");
const loadCatalogFiles_1 = require("./utils/loadCatalogFiles");
function run() {
    const intakePath = process.argv[2];
    const catalogPath = process.argv[3];
    if (!intakePath || !catalogPath) {
        console.error("Usage: node dist/runEngine.js <input.json> <catalog.json>");
        process.exit(1);
    }
    const intakeJson = JSON.parse(fs_1.default.readFileSync(intakePath, "utf8"));
    (0, validateInput_1.validateInput)(intakeJson);
    const catalog = (0, loadCatalogFiles_1.loadCatalogFiles)([catalogPath]);
    const activated = ActivationEngine_1.ActivationEngine.activate(intakeJson, catalog);
    const canonicalized = CanonicalizationEngine_1.CanonicalizationEngine.canonicalize(activated);
    const harmonized = HarmonizationEngine_1.HarmonizationEngine.harmonize(canonicalized);
    const scoring = ScoringEngine_1.ScoringEngine.score(harmonized, intakeJson);
    const roadmap = RoadmapEngine_1.RoadmapEngine.build(scoring.scored);
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
