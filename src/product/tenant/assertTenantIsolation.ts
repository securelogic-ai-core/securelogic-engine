import type { TenantContextV1 } from "./TenantContextV1";

export function assertTenantIsolation(
  ctx: TenantContextV1,
  resourceTenantId: string
): void {
  if (ctx.tenantId !== resourceTenantId) {
    throw new Error("TENANT_ISOLATION_VIOLATION");
  }
}
