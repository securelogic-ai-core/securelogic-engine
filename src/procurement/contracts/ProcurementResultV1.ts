export interface ProcurementResultV1 {
  status: "SUBMITTED" | "REJECTED";
  providerRef?: string;
  submittedAt: string;
}
