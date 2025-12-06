"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class MissingPoliciesRule {
    evaluate(control, intake) {
        const missing = intake?.signals?.missingPolicies ?? [];
        if (!missing.includes(control.id)) {
            return [];
        }
        return [
            {
                passed: false,
                message: `Missing policy for control ${control.id}`,
                deduction: 1
            }
        ];
    }
}
exports.default = MissingPoliciesRule;
