export type DataSensitivity = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export interface DataClassificationV1 {
  classification: DataSensitivity;
  encrypted: boolean;
}
