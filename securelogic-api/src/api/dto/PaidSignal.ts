import { Provenance } from "../../signals/contract/Provenance.js";

export interface PaidSignal {
  id: string;
  title: string;
  publishedAt: string;
  source: string;

  severity: number;
  confidence: number;
  occurrences: number;

  risk: {
    score: number;
    band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    rationale: string[];
  };

  provenance: Provenance;
}
