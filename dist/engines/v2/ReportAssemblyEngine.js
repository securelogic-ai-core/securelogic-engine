"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportAssemblyEngine = void 0;
class ReportAssemblyEngine {
    static build(input) {
        return {
            intakeSummary: input.intake,
            harmonized: input.canonical,
            threats: input.threatModel,
            scoring: input.scoring,
            heatmap: input.heatmap,
            roadmap: input.roadmap
        };
    }
}
exports.ReportAssemblyEngine = ReportAssemblyEngine;
