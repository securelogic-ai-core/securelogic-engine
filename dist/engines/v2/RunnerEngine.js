"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerEngine = void 0;
const ScoringEngine_1 = require("./ScoringEngine");
const EngineResultBuilder_1 = require("../../engine/adapters/EngineResultBuilder");
class RunnerEngine {
    static run(input) {
        const findings = ScoringEngine_1.ScoringEngine.score(input);
        return (0, EngineResultBuilder_1.buildEngineResult)(findings);
    }
}
exports.RunnerEngine = RunnerEngine;
