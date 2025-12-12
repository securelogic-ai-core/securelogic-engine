"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarmonizationEngine = void 0;
class HarmonizationEngine {
    static harmonize(canonicalControls) {
        // v2 Harmonization is intentionally simple:
        // 1. Remove duplicates by canonicalId
        // 2. Return stable list
        const seen = new Set();
        const output = [];
        for (const c of canonicalControls) {
            if (!seen.has(c.canonicalId)) {
                seen.add(c.canonicalId);
                output.push(c);
            }
        }
        return output;
    }
}
exports.HarmonizationEngine = HarmonizationEngine;
