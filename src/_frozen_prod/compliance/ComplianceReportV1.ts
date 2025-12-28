export interface ComplianceFinding {
  controlId: string;
  status: "pass" | "fail" | "partial";
  evidenceRefs: string[];
}

export interface ComplianceReportV1 {
  reportId: string;
  tenantId: string;
  framework: "SOC2" | "ISO27001" | "NIST";
  generatedAt: string;
  findings: ComplianceFinding[];
  immutable: true;
}
