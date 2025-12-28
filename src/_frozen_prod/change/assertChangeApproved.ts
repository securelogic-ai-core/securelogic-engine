import type { ChangeRequestV1 } from "./ChangeRequestV1";

export function assertChangeApproved(cr: ChangeRequestV1): void {
  if (!cr.approvedBy || !cr.approvedAt) {
    throw new Error("CHANGE_NOT_APPROVED");
  }
}
