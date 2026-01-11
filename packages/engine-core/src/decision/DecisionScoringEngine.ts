import type { Finding } from "../findings/Finding.js";

export function scoreFindings(findings: Finding[]) {
  const hasCritical = findings.some(f => f.severity === "CRITICAL");
  const hasHigh = findings.some(f => f.severity === "HIGH");

  if (hasCritical) return "CRITICAL";
  if (hasHigh) return "HIGH";
  if (findings.length > 0) return "MEDIUM";
  return "LOW";
}
