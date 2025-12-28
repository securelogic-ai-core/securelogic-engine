import type { EvidenceRecordV1 } from "./EvidenceRecordV1";

export function assertRetentionPolicy(e: EvidenceRecordV1): void {
  if (process.env.NODE_ENV === "production") {
    if (!e.immutable) throw new Error("EVIDENCE_MUTABLE");
    if (new Date(e.retentionUntil).getTime() <= Date.now()) {
      throw new Error("EVIDENCE_RETENTION_EXPIRED");
    }
  }
}
