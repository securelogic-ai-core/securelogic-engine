"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyExtractor = void 0;
var PolicyExtractor = /** @class */ (function () {
    function PolicyExtractor() {
    }
    PolicyExtractor.extract = function (text) {
        var lower = text.toLowerCase();
        var found = [];
        var missing = [];
        this.requiredPolicies.forEach(function (policy) {
            if (lower.includes(policy)) {
                found.push(policy);
            }
            else {
                missing.push(policy);
            }
        });
        return { found: found, missing: missing };
    };
    PolicyExtractor.requiredPolicies = [
        "access control policy",
        "incident response policy",
        "change management policy",
        "business continuity policy"
    ];
    return PolicyExtractor;
}());
exports.PolicyExtractor = PolicyExtractor;
