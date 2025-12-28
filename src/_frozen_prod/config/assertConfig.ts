import type { ConfigSchemaV1 } from "./ConfigSchemaV1";

export function assertConfig(config: ConfigSchemaV1): void {
  if (config.environment === "prod" && !config.strictMode) {
    throw new Error("INVALID_PRODUCTION_CONFIG");
  }
}
