export interface TenantContextV1 {
  tenantId: string;
  environment: "prod" | "staging" | "dev";
}
