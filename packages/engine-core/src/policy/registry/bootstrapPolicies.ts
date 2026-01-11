import { registerPolicy } from "./PolicyRegistry.js";
import { defaultPolicySet } from "../defaultPolicySet.js";

export function bootstrapPolicies() {
  for (const p of defaultPolicySet.policies) {
    if (!p.policyId) {
      throw new Error("bootstrapPolicies: policy missing policyId");
    }
    registerPolicy(p);
  }
}

// AUTO-EXECUTE
bootstrapPolicies();