import type { LicenseTier } from "../product/contracts/LicenseTier";

export type IntakeEvidenceRef = {
  id: string;
  filename: string;
};

export type IntakeEnvelopeV1 = {
  version: "V1";
  runId: string;
  receivedAt: string;

  organization: {
    orgId: string;
  };

  license: {
    tier: LicenseTier;
  };

  evidence: readonly IntakeEvidenceRef[];
};
