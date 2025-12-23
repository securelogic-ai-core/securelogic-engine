import type { EvidenceReferenceV1 } from "../contracts/evidence/EvidenceReference";

/**
 * Evidence Registry
 * -----------------
 * Collects evidence references during execution.
 * Finalized into result output.
 */
export class EvidenceRegistry {
  private readonly references: EvidenceReferenceV1[] = [];

  add(ref: EvidenceReferenceV1): void {
    this.references.push(ref);
  }

  finalize(): EvidenceReferenceV1[] {
    return [...this.references];
  }
}
