export type DataRegion = "us-east" | "us-west" | "eu-central";

export interface DataResidencyV1 {
  tenantId: string;
  region: DataRegion;
}
