import type { DataClassificationV1 } from "./DataClassificationV1";

export function assertDataHandling(data: DataClassificationV1): void {
  if (
    (data.classification === "CONFIDENTIAL" || data.classification === "RESTRICTED") &&
    !data.encrypted
  ) {
    throw new Error("DATA_HANDLING_VIOLATION");
  }
}
