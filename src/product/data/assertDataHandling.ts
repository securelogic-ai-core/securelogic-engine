import type { DataClassificationV1 } from "./DataClassificationV1";

export function assertDataHandling(
  classification: DataClassificationV1,
  actorTenantId: string
): void {
  if (classification.ownerTenantId !== actorTenantId) {
    throw new Error("DATA_HANDLING_VIOLATION");
  }
}
