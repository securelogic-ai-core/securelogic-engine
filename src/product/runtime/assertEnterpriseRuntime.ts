export function assertEnterpriseRuntime(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.ENTERPRISE_MODE) {
    throw new Error("ENTERPRISE_MODE not enabled");
  }
}
