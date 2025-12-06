"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyExtractor = void 0;
class PolicyExtractor {
    static extract(text) {
        const lower = text.toLowerCase();
        const found = [];
        const missing = [];
        this.requiredPolicies.forEach(policy => {
            if (lower.includes(policy)) {
                found.push(policy);
            }
            else {
                missing.push(policy);
            }
        });
        return { found, missing };
    }
}
exports.PolicyExtractor = PolicyExtractor;
PolicyExtractor.requiredPolicies = [
    "access control policy",
    "incident response policy",
    "change management policy",
    "business continuity policy"
];
