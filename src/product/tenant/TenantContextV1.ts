export interface TenantContextV1 {
  tenantId: string;
  environment: "dev" | "staging" | "prod";
}
