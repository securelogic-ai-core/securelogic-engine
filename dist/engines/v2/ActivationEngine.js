"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivationEngine = void 0;
/**
 * ActivationEngine (v2)
 *
 * - Normalizes intake (clean, deterministic)
 * - Activates catalog controls based on keywords
 * - Zero AI. Zero inference. Fully auditable.
 */
class ActivationEngine {
    /**
     * Main entry point used by RunnerEngine
     */
    static run(intake, catalog) {
        const normalized = this.normalize(intake);
        const activated = this.activate(normalized, catalog);
        return { intake: normalized, activated };
    }
    /**
     * Normalize RawIntakeSubmission → NormalizedIntake
     */
    static normalize(input) {
        const triggers = (input.triggers || [])
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0);
        return {
            triggers,
            frameworks: input.frameworks || [],
            domains: input.domains || [],
            controlIds: input.controlIds || [],
            size: input.size || "medium",
            industry: input.industry
        };
    }
    /**
     * Deterministic activation based strictly on keyword matches.
     */
    static activate(intake, catalog) {
        const activated = [];
        for (const control of catalog) {
            const keywords = control.keywords.map(k => k.toLowerCase());
            // Activate control if ANY keyword matches ANY trigger
            const match = keywords.some(k => intake.triggers.includes(k));
            if (match) {
                activated.push(control);
            }
        }
        return activated;
    }
}
exports.ActivationEngine = ActivationEngine;
