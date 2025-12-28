export function assertTenantIsolation(
  actorTenantId: string,
  resourceTenantId: string
): void {
  if (actorTenantId !== resourceTenantId) {
    throw new Error("TENANT_ISOLATION_VIOLATION");
  }
}
