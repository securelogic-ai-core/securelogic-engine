import type { TenantContextV1 } from "./TenantContextV1";

export function assertTenantBoundary(
  context: TenantContextV1,
  resourceTenantId: string
): void {
  if (context.tenantId !== resourceTenantId) {
    throw new Error("TENANT_BOUNDARY_VIOLATION");
  }
}
