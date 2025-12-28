export type DataSensitivity =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "RESTRICTED";

export interface DataClassificationV1 {
  resourceId: string;
  sensitivity: DataSensitivity;
  ownerTenantId: string;
}
