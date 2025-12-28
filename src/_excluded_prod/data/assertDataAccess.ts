import type { DataClassificationV1 } from "./DataClassificationV1";

export function assertDataAccess(
  classification: DataClassificationV1,
  actorClearance: DataClassificationV1["sensitivity"]
): void {
  const order = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
  if (order.indexOf(actorClearance) < order.indexOf(classification.sensitivity)) {
    throw new Error("DATA_ACCESS_DENIED");
  }
}
