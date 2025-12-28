import type { TenantContextV1 } from "./TenantContextV1";

export function assertTenantIsolation(
  requester: TenantContextV1,
  resourceTenantId: string
): void {
  if (requester.tenantId !== resourceTenantId) {
    throw new Error("TENANT_ISOLATION_VIOLATION");
  }
}
