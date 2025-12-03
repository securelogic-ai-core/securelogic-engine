"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeEngine = void 0;
class IntakeEngine {
    static normalize(input) {
        return {
            size: input.size ?? "small",
            industry: input.industry?.toLowerCase() ?? undefined,
            triggers: (input.triggers ?? []).map(t => t.trim().toLowerCase()),
            // REQUIRED BY NormalizedIntake
            frameworks: input.frameworks ?? [],
            domains: input.domains ?? [],
            controlIds: input.controlIds ?? [],
        };
    }
}
exports.IntakeEngine = IntakeEngine;
