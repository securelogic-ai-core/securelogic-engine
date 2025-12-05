"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeEngine = void 0;
class IntakeEngine {
    static normalize(input) {
        return {
            size: input.size ?? "small",
            triggers: (input.triggers ?? []).map(x => x.toLowerCase()),
            frameworks: (input.frameworks ?? []).map(x => x.toLowerCase()),
            domains: (input.domains ?? []).map(x => x.toLowerCase()),
            controlIds: (input.controlIds ?? []).map(x => x.toLowerCase())
        };
    }
}
exports.IntakeEngine = IntakeEngine;
