"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class MissingProceduresRule {
    evaluate(control, intake) {
        const missing = intake?.signals?.missingProcedures ?? [];
        if (!missing.includes(control.id)) {
            return [];
        }
        return [
            {
                passed: false,
                message: `Missing procedures for control ${control.id}`,
                deduction: 1
            }
        ];
    }
}
exports.default = MissingProceduresRule;
