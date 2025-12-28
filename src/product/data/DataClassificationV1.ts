export type DataSensitivity =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "RESTRICTED";

export interface DataClassificationV1 {
  sensitivity: DataSensitivity;
  regulated: boolean;
  retentionPolicyId?: string;
}
