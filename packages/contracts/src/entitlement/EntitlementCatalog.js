/**
 * Canonical Product SKUs
 * LOCKED — pricing maps here
 */
export const ENTITLEMENT_CATALOG = {
    CORE: {
        executiveSummary: true,
        findings: true,
        riskRollup: true,
        remediationPlan: false,
        evidence: false,
        controlTraces: false,
        attestations: false,
        export: {
            pdf: false,
            json: true
        }
    },
    PRO: {
        executiveSummary: true,
        findings: true,
        riskRollup: true,
        remediationPlan: true,
        evidence: true,
        controlTraces: true,
        attestations: false,
        export: {
            pdf: true,
            json: true
        }
    },
    ENTERPRISE: {
        executiveSummary: true,
        findings: true,
        riskRollup: true,
        remediationPlan: true,
        evidence: true,
        controlTraces: true,
        attestations: true,
        export: {
            pdf: true,
            json: true
        }
    }
};
