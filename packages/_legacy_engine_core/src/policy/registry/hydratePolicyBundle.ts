import { getPolicy } from "./PolicyRegistry.js";

export function hydratePolicyBundle(bundle: any) {
  if (!bundle || !Array.isArray(bundle.policies)) {
    throw new Error("hydratePolicyBundle: invalid bundle");
  }

  return {
    ...bundle,
    policies: bundle.policies.map((p: any) => {
      if (!p.policyId) {
        throw new Error("hydratePolicyBundle: policy missing policyId");
      }

      const exec = getPolicy(p.policyId);
      return exec;
    })
  };
}