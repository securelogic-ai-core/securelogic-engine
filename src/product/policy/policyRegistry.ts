import type { PolicyV1 } from "./PolicyV1";
import { deepFreeze } from "../integrity/deepFreeze";

const policies = new Map<string, PolicyV1>();

export function registerPolicy(policy: PolicyV1): void {
  policies.set(policy.policyId, deepFreeze(policy));
}

export function getPolicy(policyId: string): PolicyV1 | undefined {
  return policies.get(policyId);
}

export function listPolicies(): readonly PolicyV1[] {
  return [...policies.values()];
}
