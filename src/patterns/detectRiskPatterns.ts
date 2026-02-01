import type { Signal } from "../signals/Signal.js";
import type { RiskPattern } from "./RiskPattern.js";

export function detectRiskPatterns(signals: Signal[]): RiskPattern[] {
  if (signals.length === 0) return [];

  return [{
    id: "systemic-identity-failure",
    title: "Credential-Based Systemic Failure",
    description: "High-impact systems compromised via weak identity controls",
    signals,
    domains: Array.from(new Set(signals.flatMap(s => s.domains))),
    impactLevel: "CRITICAL"
  }];
}
