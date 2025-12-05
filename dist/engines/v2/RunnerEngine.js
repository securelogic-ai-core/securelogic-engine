"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerEngine = void 0;
const ActivationEngine_1 = require("./ActivationEngine");
const CanonicalizationEngine_1 = require("./CanonicalizationEngine");
const HarmonizationEngine_1 = require("./HarmonizationEngine");
const ScoringEngine_1 = require("./ScoringEngine");
const RoadmapEngine_1 = require("./RoadmapEngine");
class RunnerEngine {
    static run(intake, catalogInput) {
        // 1. Normalize catalog structure
        const catalog = Array.isArray(catalogInput)
            ? catalogInput
            : catalogInput.controls ?? [];
        if (!Array.isArray(catalog)) {
            throw new Error("Catalog must resolve to an array.");
        }
        // 2. Activation
        const activated = ActivationEngine_1.ActivationEngine.activate(intake, catalog);
        // 3. Canonicalization
        const canonicalized = CanonicalizationEngine_1.CanonicalizationEngine.canonicalize(activated);
        // 4. Harmonization
        const harmonized = HarmonizationEngine_1.HarmonizationEngine.harmonize(canonicalized);
        // 5. Scoring
        const scoring = ScoringEngine_1.ScoringEngine.score(harmonized, intake);
        // 6. Roadmap
        const roadmap = RoadmapEngine_1.RoadmapEngine.build(scoring.scored);
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
exports.RunnerEngine = RunnerEngine;
