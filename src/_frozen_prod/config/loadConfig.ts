import type { AppConfigV1 } from "./AppConfigV1";

export function loadConfig(): AppConfigV1 {
  const { NODE_ENV, DATA_DIR, AUDIT_DIR } = process.env;

  if (!NODE_ENV || !DATA_DIR || !AUDIT_DIR) {
    throw new Error("Missing required environment configuration");
  }

  return {
    environment: NODE_ENV as AppConfigV1["environment"],
    dataDir: DATA_DIR,
    auditDir: AUDIT_DIR,
  };
}
