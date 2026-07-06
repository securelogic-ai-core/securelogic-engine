/**
 * graphRiskPropagation.test.ts — ERIP E3.P1: the pure graph risk engine
 * (ERIP-AD-15/17). Deterministic; bounded [0,100]; explainable.
 */

import { describe, expect, it } from "vitest";
import { propagateRisk, DEFAULT_DEPENDENCY_DECAY, type RiskNode } from "../lib/graphRiskPropagation.js";

const SEED = { node_type: "asset", node_id: "a" };

function nodes(...xs: Array<[string, number, number]>): RiskNode[] {
  return xs.map(([node_id, own_risk, depth]) => ({ node_type: node_id === "a" ? "asset" : "vendor", node_id, own_risk, depth }));
}

describe("propagateRisk", () => {
  it("direct risk is the seed's own risk; no dependencies → inherited 0", () => {
    const r = propagateRisk(SEED, nodes(["a", 50, 0]));
    expect(r.direct_risk).toBe(50);
    expect(r.inherited_risk).toBe(0);
    expect(r.total_risk).toBe(50);
    expect(r.contributors).toEqual([]);
  });

  it("a one-hop dependency contributes own_risk × decay and is traced", () => {
    const r = propagateRisk(SEED, nodes(["a", 0, 0], ["b", 100, 1]), 0.6);
    expect(r.contributors).toHaveLength(1);
    expect(r.contributors[0]).toMatchObject({ node_id: "b", own_risk: 100, depth: 1, contribution: 60 });
    expect(r.inherited_risk).toBe(60);
    expect(r.total_risk).toBe(60); // direct 0 noisy-OR 60 = 60
  });

  it("decays with distance", () => {
    const one = propagateRisk(SEED, nodes(["a", 0, 0], ["b", 100, 1]), 0.5);
    const two = propagateRisk(SEED, nodes(["a", 0, 0], ["b", 100, 2]), 0.5);
    expect(one.contributors[0].contribution).toBe(50);
    expect(two.contributors[0].contribution).toBe(25);
  });

  it("combines independent dependencies via noisy-OR, bounded at 100", () => {
    // Two 1-hop deps at own 100, decay 0.6 → each contributes 60.
    // noisyOr(60,60) = 100*(1-0.4*0.4) = 84.
    const r = propagateRisk(SEED, nodes(["a", 0, 0], ["b", 100, 1], ["c", 100, 1]), 0.6);
    expect(r.inherited_risk).toBe(84);
    // Many high contributors never exceed 100.
    const many = propagateRisk(
      SEED,
      nodes(["a", 90, 0], ["b", 100, 1], ["c", 100, 1], ["d", 100, 1], ["e", 100, 1]),
      0.9
    );
    expect(many.total_risk).toBeLessThanOrEqual(100);
    expect(many.total_risk).toBeGreaterThanOrEqual(many.direct_risk);
  });

  it("ignores zero-risk dependencies and the seed-as-contributor", () => {
    const r = propagateRisk(SEED, nodes(["a", 30, 0], ["b", 0, 1], ["c", 50, 1]), 0.6);
    expect(r.contributors.map((c) => c.node_id)).toEqual(["c"]);
    expect(r.direct_risk).toBe(30);
  });

  it("orders contributors by contribution desc (explainability)", () => {
    const r = propagateRisk(SEED, nodes(["a", 0, 0], ["low", 40, 1], ["high", 90, 1]), 0.6);
    expect(r.contributors.map((c) => c.node_id)).toEqual(["high", "low"]);
  });

  it("is deterministic", () => {
    const ns = nodes(["a", 50, 0], ["b", 80, 1], ["c", 70, 2]);
    expect(propagateRisk(SEED, ns)).toEqual(propagateRisk(SEED, ns));
  });

  it("uses the default decay when unspecified", () => {
    const r = propagateRisk(SEED, nodes(["a", 0, 0], ["b", 100, 1]));
    expect(r.contributors[0].contribution).toBe(Math.round(100 * DEFAULT_DEPENDENCY_DECAY));
  });
});
