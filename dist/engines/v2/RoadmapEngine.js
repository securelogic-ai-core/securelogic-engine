"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoadmapEngine = void 0;
class RoadmapEngine {
    static build(scored) {
        const sorted = [...scored].sort((a, b) => b.risk - a.risk);
        const items = sorted.map((control, index) => ({
            id: control.id,
            title: control.title,
            priority: index + 1
        }));
        return { items };
    }
}
exports.RoadmapEngine = RoadmapEngine;
