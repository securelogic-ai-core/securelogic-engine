/**
 * Finding Lineage — V1
 *
 * Cryptographically traceable lineage
 * from control → finding → evidence.
 *
 * ENTERPRISE AUDIT CONTRACT
 */
export interface FindingLineageV1 {
  findingId: string;

  controlId: string;
  controlDomain: string;

  scoringSource: "engine" | "override";

  evidenceIds: string[];

  derivedAt: string;
}
