/**
 * Finding — V1
 *
 * Normalized audit finding with control attribution.
 * ENTERPRISE AUDIT CONTRACT
 */
export interface FindingV1 {
  id: string;

  severity: "Low" | "Medium" | "High" | "Critical";

  domain: string;
  controlId: string;

  title: string;
  description: string;

  evidenceIds: string[];

  detectedAt: string;
}
