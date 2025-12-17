"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditResultBuilder = void 0;
class AuditResultBuilder {
    static build(params) {
        return {
            version: "v1",
            metadata: {
                auditId: params.auditId,
                generatedAt: new Date().toISOString(),
                engineVersion: params.engineVersion
            },
            enterpriseSummary: params.summary,
            riskDecision: params.decision
        };
    }
}
exports.AuditResultBuilder = AuditResultBuilder;
