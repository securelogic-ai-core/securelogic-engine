export function assertTenantIsolation(
  resourceTenantId: string,
  actorTenantId: string
): void {
  if (resourceTenantId !== actorTenantId) {
    throw new Error("TENANT_ISOLATION_VIOLATION");
  }
}
