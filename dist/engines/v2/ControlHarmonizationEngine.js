"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlHarmonizationEngine = void 0;
/**
 * ControlHarmonizationEngine (v2)
 *
 * Merges CanonicalControls that represent the same conceptual control.
 * Dedupes by canonicalId.
 * Framework lists are merged deterministically with no duplicates.
 * Zero AI. Fully audit-defensible.
 */
class ControlHarmonizationEngine {
    /**
     * Group and merge controls by canonicalId.
     */
    static harmonize(controls) {
        const map = new Map();
        for (const c of controls) {
            if (!map.has(c.canonicalId)) {
                // first time seeing this canonical control
                map.set(c.canonicalId, { ...c });
            }
            else {
                // already exists → merge frameworks, dedupe
                const existing = map.get(c.canonicalId);
                existing.frameworks = Array.from(new Set([...(existing.frameworks || []), ...(c.frameworks || [])]));
                // title, description, domain, keywords already normalized in canonicalization
                // We never overwrite them — canonicalization is authoritative.
            }
        }
        return Array.from(map.values());
    }
}
exports.ControlHarmonizationEngine = ControlHarmonizationEngine;
