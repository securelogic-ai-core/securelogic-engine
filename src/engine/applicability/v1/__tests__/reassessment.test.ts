/**
 * reassessment.test.ts — S7: reassessment triggers + drift detection. Database-free.
 * Core DONE bar: a changed signal re-evaluates its linked entities.
 */

import { describe, expect, it } from "vitest";

import {
  planReassessment,
  detectDrift,
  type LinkedAssessment,
  type ChangeEvent
} from "../reassessment.js";
import type { StoredAssessment } from "../explainability.js";
import type { ApplicabilityDecision } from "../types.js";

const linked: LinkedAssessment[] = [
  { organization_id: "orgA", signal_id: "sig-1", target_type: "vendor", target_id: "v-1", affected: [{ node_type: "application", node_id: "app-1" }] },
  { organization_id: "orgA", signal_id: "sig-1", target_type: "ai_system", target_id: "ai-1", affected: [] },
  { organization_id: "orgA", signal_id: "sig-2", target_type: "vendor", target_id: "v-2", affected: [{ node_type: "application", node_id: "app-1" }] },
  { organization_id: "orgB", signal_id: "sig-1", target_type: "vendor", target_id: "v-9", affected: [] }
];

describe("planReassessment — triggers", () => {
  it("signal_changed re-evaluates every assessment for that signal (all orgs)", () => {
    const plan = planReassessment({ type: "signal_changed", signal_id: "sig-1" }, linked);
    expect(plan.items.map((i) => `${i.organization_id}:${i.target_id}`)).toEqual(["orgA:ai-1", "orgA:v-1", "orgB:v-9"]);
    expect(plan.items.every((i) => i.reason === "signal_changed")).toBe(true);
  });

  it("signal_changed for an unknown signal re-evaluates nothing", () => {
    expect(planReassessment({ type: "signal_changed", signal_id: "nope" }, linked).items).toEqual([]);
  });

  it("edge_changed re-evaluates org-scoped assessments whose target OR blast radius is touched", () => {
    // app-1 is in the blast radius of orgA/sig-1/v-1 and orgA/sig-2/v-2.
    const ev: ChangeEvent = { type: "edge_changed", organization_id: "orgA", node_type: "application", node_id: "app-1" };
    const plan = planReassessment(ev, linked);
    expect(plan.items.map((i) => i.target_id).sort()).toEqual(["v-1", "v-2"]);
    expect(plan.items[0].reason).toContain("edge_changed:application|app-1");
  });

  it("entity_changed matching a target re-evaluates that assessment", () => {
    const ev: ChangeEvent = { type: "entity_changed", organization_id: "orgA", node_type: "vendor", node_id: "v-1" };
    const plan = planReassessment(ev, linked);
    expect(plan.items.map((i) => i.target_id)).toEqual(["v-1"]);
  });

  it("edge_changed is org-scoped — does not cross into another org", () => {
    const ev: ChangeEvent = { type: "edge_changed", organization_id: "orgB", node_type: "application", node_id: "app-1" };
    expect(planReassessment(ev, linked).items).toEqual([]);
  });

  it("output is deduped by (org, signal, target) and deterministically ordered", () => {
    const dupes = [...linked, linked[0], linked[0]];
    const plan = planReassessment({ type: "signal_changed", signal_id: "sig-1" }, dupes);
    const keys = plan.items.map((i) => `${i.organization_id}|${i.signal_id}|${i.target_type}|${i.target_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort());
  });
});

function stored(decision: ApplicabilityDecision, band: StoredAssessment["confidence_band"], nodes: string[]): StoredAssessment {
  return {
    organization_id: "orgA",
    signal_id: "sig-1",
    target_type: "vendor",
    target_id: "v-1",
    decision,
    confidence: 80,
    confidence_band: band,
    reasoning_steps: [],
    affected_entities: nodes.map((n) => ({ node_type: "application", node_id: n, min_depth: 1, via_target_type: "vendor", via_target_id: "v-1" })),
    evidence: [],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1",
    content_hash: "x",
    prev_hash: "0".repeat(64)
  };
}

describe("detectDrift", () => {
  it("null prior -> new, high severity for affected", () => {
    const d = detectDrift(null, stored("affected", "high", ["app-1"]));
    expect(d).toMatchObject({ drifted: true, kind: "new", severity: "high" });
    expect(d.added_entities).toEqual(["application|app-1"]);
  });

  it("null prior -> new, low severity for not_affected", () => {
    expect(detectDrift(null, stored("not_affected", "high", [])).severity).toBe("low");
  });

  it("identical decision -> no drift", () => {
    const a = stored("affected", "high", ["app-1"]);
    const b = stored("affected", "high", ["app-1"]);
    expect(detectDrift(a, b)).toMatchObject({ drifted: false, kind: "none", severity: "none" });
  });

  it("decision change crossing 'affected' -> high severity", () => {
    const d = detectDrift(stored("potentially_affected", "medium", ["app-1"]), stored("affected", "high", ["app-1"]));
    expect(d.kind).toBe("decision_change");
    expect(d.severity).toBe("high");
    expect(d.changes.some((c) => c.includes("decision:"))).toBe(true);
  });

  it("decision change NOT touching 'affected' -> medium severity", () => {
    const d = detectDrift(stored("potentially_affected", "medium", []), stored("not_affected", "high", []));
    expect(d.severity).toBe("medium");
  });

  it("only confidence_band change -> medium, confidence_band_change", () => {
    const d = detectDrift(stored("affected", "medium", ["app-1"]), stored("affected", "high", ["app-1"]));
    expect(d.kind).toBe("confidence_band_change");
    expect(d.severity).toBe("medium");
  });

  it("only blast-radius change -> reports added/removed entities", () => {
    const d = detectDrift(stored("affected", "high", ["app-1"]), stored("affected", "high", ["app-2", "app-3"]));
    expect(d.kind).toBe("blast_radius_change");
    expect(d.added_entities).toEqual(["application|app-2", "application|app-3"]);
    expect(d.removed_entities).toEqual(["application|app-1"]);
  });

  it("is deterministic", () => {
    const a = stored("affected", "high", ["app-1"]);
    const b = stored("not_affected", "low", ["app-2"]);
    expect(detectDrift(a, b)).toEqual(detectDrift(a, b));
  });
});
