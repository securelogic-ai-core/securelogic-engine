export const ENTITLEMENT_MATRIX = {
    Community: {
        executiveSummary: true,
        findings: false,
        remediationPlan: false,
        controlTraces: false,
        evidence: false,
        riskRollup: false,
        attestations: false,
        verification: false
    },
    Professional: {
        executiveSummary: true,
        findings: true,
        remediationPlan: true,
        controlTraces: false,
        evidence: true,
        riskRollup: true,
        attestations: false,
        verification: false
    },
    Enterprise: {
        executiveSummary: true,
        findings: true,
        remediationPlan: true,
        controlTraces: true,
        evidence: true,
        riskRollup: true,
        attestations: true,
        verification: true
    },
    Regulated: {
        executiveSummary: true,
        findings: true,
        remediationPlan: true,
        controlTraces: true,
        evidence: true,
        riskRollup: true,
        attestations: true,
        verification: true
    }
};
