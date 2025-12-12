"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class MissingEvidenceRule {
    evaluate(control, intake) {
        const missing = intake?.signals?.missingEvidence ?? [];
        if (!missing.includes(control.id)) {
            return [];
        }
        return [
            {
                passed: false,
                message: `Missing evidence for control ${control.id}`,
                deduction: 1
            }
        ];
    }
}
exports.default = MissingEvidenceRule;
