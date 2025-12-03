"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarmonizationEngine = void 0;
/**
 * HarmonizationEngine (v2)
 *
 * Groups canonical controls by domain with deterministic ordering.
 * No mutations. No assumptions. Fully auditable.
 */
class HarmonizationEngine {
    static harmonize(controls) {
        const domains = {};
        for (const c of controls) {
            const domain = c.canonicalDomain || "Uncategorized";
            if (!domains[domain]) {
                domains[domain] = {
                    domain,
                    controls: []
                };
            }
            domains[domain].controls.push(c);
        }
        // Enforce deterministic ordering (important for testing + audit)
        return Object.values(domains)
            .sort((a, b) => a.domain.localeCompare(b.domain))
            .map(group => ({
            ...group,
            controls: group.controls.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId))
        }));
    }
}
exports.HarmonizationEngine = HarmonizationEngine;
