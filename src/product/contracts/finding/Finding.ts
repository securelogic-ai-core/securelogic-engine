import type { FindingLineageV1 } from "../lineage/FindingLineage";

/**
 * Finding — V1
 *
 * Atomic, immutable audit finding
 */
export interface FindingV1 {
  id: string; // deterministic
  title: string;
  description: string;

  severity: "Low" | "Medium" | "High" | "Critical";

  lineage: FindingLineageV1;
}
