"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoadmapEngine = void 0;
/**
 * RoadmapEngine (v2)
 *
 * Deterministic remediation roadmap.
 * No AI-generated text. No randomization.
 * Fully rules-based with stable scoring logic.
 */
class RoadmapEngine {
    static build(scoring) {
        const items = scoring.scored.map(s => this.toRoadmapItem(s));
        return { items };
    }
    static toRoadmapItem(s) {
        return {
            controlId: s.controlId,
            title: s.title,
            currentMaturity: this.mapCurrentMaturity(s),
            targetMaturity: 5,
            priority: this.mapPriority(s),
            recommendation: this.mapRecommendation(s)
        };
    }
    static mapCurrentMaturity(s) {
        // Simple deterministic mapping
        const risk = s.risk;
        if (risk >= 15)
            return 1;
        if (risk >= 10)
            return 2;
        if (risk >= 6)
            return 3;
        if (risk >= 3)
            return 4;
        return 5;
    }
    static mapPriority(s) {
        // Lower number = higher priority
        const risk = s.risk;
        if (risk >= 15)
            return 1; // Critical
        if (risk >= 10)
            return 2; // High
        if (risk >= 6)
            return 3; // Medium
        if (risk >= 3)
            return 4; // Low
        return 5; // Minimal
    }
    static mapRecommendation(s) {
        const priority = this.mapPriority(s);
        switch (priority) {
            case 1:
                return `Critical: ${s.title} must be addressed in the immediate sprint.`;
            case 2:
                return `High: Remediate ${s.title} in the next scheduled sprint window.`;
            case 3:
                return `Medium: Address ${s.title} during the next quarterly cycle.`;
            case 4:
                return `Low: Improve ${s.title} during standard review cycles.`;
            default:
                return `Monitor: ${s.title} requires no immediate remediation.`;
        }
    }
}
exports.RoadmapEngine = RoadmapEngine;
