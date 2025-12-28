import type { ApiLifecycleV1 } from "./ApiLifecycleV1";

export function assertApiActive(api: ApiLifecycleV1): void {
  if (api.deprecated && api.sunsetDate && Date.now() > Date.parse(api.sunsetDate)) {
    throw new Error("API_SUNSET_ENFORCED");
  }
}
