import type { EnterpriseConfig } from "./EnterpriseConfig";
import { DEFAULT_ENTERPRISE_CONFIG } from "./defaultEnterpriseConfig";

export function loadEnterpriseConfig(
  overrides?: Partial<EnterpriseConfig>
): EnterpriseConfig {
  return Object.freeze({
    ...DEFAULT_ENTERPRISE_CONFIG,
    ...overrides
  });
}
