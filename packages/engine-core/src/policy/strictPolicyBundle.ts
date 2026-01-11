import type { ExecutablePolicy } from "./registry/ExecutablePolicy.js";
import { defaultPolicySet } from "./defaultPolicySet.js";

/**
 * Produces a strict policy bundle where:
 * - Policy identity (policyId) is NEVER changed
 * - All policies always escalate to REQUIRE_REVIEW or DENY
 * - Bundle remains replay-safe and registry-compatible
 */
export const strictPolicyBundle = {
  bundleId: "STRICT-BUNDLE-0001",
  name: "Strict Security Policy Bundle",
  createdAt: new Date().toISOString(),

  policies: defaultPolicySet.policies.map((p: ExecutablePolicy) => {
    if (!p || !p.policyId) {
      throw new Error("strictPolicyBundle: base policy missing policyId");
    }

    return {
      // 🔒 IDENTITY IS SACRED — DO NOT TOUCH
      policyId: p.policyId,
      name: p.name,
      appliesTo: p.appliesTo,
      description: "Strict override of: " + p.name,

      evaluate(input: any) {
        const base = p.evaluate(input);

        // You can choose DENY or REQUIRE_REVIEW globally here
        return {
          effect: "DENY",
          reason:
            base?.reason ??
            "Strict policy bundle: denying due to hardened posture"
        };
      }
    };
  })
};