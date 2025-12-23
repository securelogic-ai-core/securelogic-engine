/**
 * Evidence Link — V1
 *
 * Associates evidence with a logical audit target.
 * ENTERPRISE AUDIT CONTRACT
 */
export interface EvidenceLinkV1 {
  targetType: "domain" | "control" | "finding";
  targetId: string;
  evidenceIds: string[];
}
