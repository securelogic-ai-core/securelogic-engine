import type { ExecutablePolicy } from "./ExecutablePolicy.js";

const registry = new Map<string, ExecutablePolicy>();

export function registerPolicy(policy: ExecutablePolicy) {
  if (!policy || !policy.policyId) {
    throw new Error("registerPolicy: invalid policy (missing policyId)");
  }

  if (registry.has(policy.policyId)) {
    throw new Error(`registerPolicy: duplicate policyId: ${policy.policyId}`);
  }

  registry.set(policy.policyId, policy);
}

export function getPolicy(policyId: string): ExecutablePolicy {
  const p = registry.get(policyId);
  if (!p) {
    throw new Error(`Policy not registered: ${policyId}`);
  }
  return p;
}

export function hasPolicy(policyId: string): boolean {
  return registry.has(policyId);
}

// Optional but useful for diagnostics
export function listRegisteredPolicies(): string[] {
  return Array.from(registry.keys());
}