import type { ExecutablePolicy } from "./registry/ExecutablePolicy.js";

export const defaultPolicySet = {
  policies: <ExecutablePolicy[]>[
    {
      policyId: "POL-001",
      name: "Deny Critical Findings",
      appliesTo: ["VENDOR", "SYSTEM", "AI_MODEL", "ENVIRONMENT"],
      evaluate({ findings }) {
        const hasCritical = findings.some(f => f.severity === "CRITICAL");
        return {
          effect: hasCritical ? "DENY" : "ALLOW",
          reason: null
        };
      }
    },
    {
      policyId: "POL-002",
      name: "Review High Risk",
      appliesTo: ["VENDOR", "SYSTEM", "AI_MODEL", "ENVIRONMENT"],
      evaluate({ findings }) {
        const hasHigh = findings.some(f => f.severity === "HIGH");
        return {
          effect: hasHigh ? "REQUIRE_REVIEW" : "ALLOW",
          reason: null
        };
      }
    }
  ]
};