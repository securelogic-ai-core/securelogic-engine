// This is the canonical execution contract for all policies in the engine.

type PolicyInput = {
  context: any;     // TODO: replace with RiskContext when stabilized
  findings: any[];  // TODO: replace with Finding[] when stabilized
};

type PolicyEffect = "ALLOW" | "DENY" | "REQUIRE_REVIEW";

type PolicyResult = {
  effect: PolicyEffect;
  reason: string | null;
};

export interface ExecutablePolicy {
  // 🔥 Canonical ID used everywhere: registry, bundles, lineage, replay
  policyId: string;

  // Human-readable name
  name: string;

  // What subjects this policy applies to
  appliesTo: string[];

  // Execute policy logic
  evaluate(input: PolicyInput): PolicyResult;
}