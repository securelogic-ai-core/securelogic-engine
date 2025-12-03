"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerEngine = void 0;
const controlCatalog_json_1 = __importDefault(require("../../data/controlCatalog.json"));
const IntakeEngine_1 = require("./IntakeEngine");
const ActivationEngine_1 = require("./ActivationEngine");
const CanonicalizationEngine_1 = require("./CanonicalizationEngine");
const HarmonizationEngine_1 = require("./HarmonizationEngine");
const ScoringEngine_1 = require("./ScoringEngine");
const HeatmapEngine_1 = require("./HeatmapEngine");
const ThreatModelEngine_1 = require("./ThreatModelEngine");
const RoadmapEngine_1 = require("./RoadmapEngine");
const ReportAssemblyEngine_1 = require("./ReportAssemblyEngine");
/**
 * RunnerEngine (v2)
 * The ONLY canonical pipeline.
 */
class RunnerEngine {
    static execute(raw) {
        const intake = IntakeEngine_1.IntakeEngine.normalize(raw);
        const activated = ActivationEngine_1.ActivationEngine.activate(intake, controlCatalog_json_1.default);
        const canonical = CanonicalizationEngine_1.CanonicalizationEngine.canonicalize(activated);
        const harmonized = HarmonizationEngine_1.HarmonizationEngine.harmonize(canonical);
        const scoring = ScoringEngine_1.ScoringEngine.score(harmonized);
        const heatmap = HeatmapEngine_1.HeatmapEngine.build(scoring);
        const threats = ThreatModelEngine_1.ThreatModelEngine.build(scoring);
        const roadmap = RoadmapEngine_1.RoadmapEngine.build(scoring);
        return ReportAssemblyEngine_1.ReportAssemblyEngine.build({
            harmonized,
            scoring,
            heatmap,
            threats,
            roadmap
        });
    }
}
exports.RunnerEngine = RunnerEngine;
