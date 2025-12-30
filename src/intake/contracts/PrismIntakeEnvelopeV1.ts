export type ISO8601 = string;

export type RenderTarget = "PDF" | "DASHBOARD" | "JSON";

export type PrismIntakeEnvelopeV1 = {
  header: {
    envelopeId: string;
    schemaVersion: "V1";
    createdAt: ISO8601;
    submittedAt: ISO8601;
  };

  organization: {
    organizationId: string;
    legalName: string;
    industry: string;
    sizeBand: "SMB" | "MID" | "ENTERPRISE";
    geography: string[];
  };

  engagement: {
    engagementId: string;
    engagementType:
      | "SOC2_READINESS"
      | "SOC2_REVIEW"
      | "AI_GOVERNANCE"
      | "VENDOR_RISK"
      | "CUSTOM";
    requestedOutputs: RenderTarget[];
  };

  license: {
    tier: "CORE" | "PRO" | "ENTERPRISE";
    version: "V1";
  };

  scope: {
    frameworks: string[];
    trustCriteria?: string[];
    inScopeSystems: string[];
    outOfScopeSystems: string[];
    assumptions: string[];
  };

  responses: {
    questionId: string;
    answer: "YES" | "NO" | "PARTIAL" | "NA";
    confidence?: "LOW" | "MEDIUM" | "HIGH";
  }[];

  evidence: {
    evidenceId: string;
    type: "POLICY" | "SCREENSHOT" | "LOG" | "REPORT" | "OTHER";
    hash: string;
    uploadedAt: ISO8601;
    declaredPurpose: string;
  }[];

  attestations: {
    accuracyConfirmed: true;
    authorizationGranted: true;
    evidenceComplete: true;
    attestedBy: {
      name: string;
      title: string;
      email: string;
    };
  };

  extensions?: Record<string, unknown>;
};
