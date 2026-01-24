import type { RiskContext } from "../context/RiskContext.js";
import type { Finding } from "../findings/Finding.js";

// 🔥 MUST use .js extension to ensure same module instance
import { hydratePolicyBundle } from "./registry/hydratePolicyBundle.js";

export function evaluatePolicies(
  bundle: any,
  input: {
    context: RiskContext;
    findings: Finding[];
  }
) {
  if (!bundle) {
    throw new Error("evaluatePolicies: missing policy bundle");
  }

  if (!bundle.policies || !Array.isArray(bundle.policies)) {
    throw new Error("evaluatePolicies: invalid bundle format (missing policies[])");
  }

  // 🔥 Convert JSON bundle → executable policies via registry
  const policySet = hydratePolicyBundle(bundle);

  if (!policySet.policies || policySet.policies.length === 0) {
    throw new Error("evaluatePolicies: hydrated bundle has zero executable policies");
  }

  const decisions: any[] = [];

  for (const policy of policySet.policies) {
    // Defensive checks
    if (!policy || !policy.policyId || !policy.evaluate) {
      throw new Error("evaluatePolicies: invalid executable policy object");
    }

    // Skip if not applicable
    if (!policy.appliesTo.includes(input.context.subjectType)) {
      continue;
    }

    const result = policy.evaluate(input);

    if (result) {
      decisions.push({
        policyId: policy.policyId,
        name: policy.name,
        ...result
      });
    }
  }

  return decisions;
}