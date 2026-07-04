/**
 * reassessment.ts — Slice 7 (S7): the pure signal→platform LINKAGE core —
 * reassessment triggers + drift detection. I/O-free and deterministic.
 *
 * Two pure functions the later reassessment worker composes:
 *  1. planReassessment(event, linked) — given a change (a signal changed, or a graph
 *     edge / entity changed for an org), select exactly the existing assessments that
 *     must be RE-EVALUATED. AD-14: scope reassessment to assessments whose target OR
 *     blast radius is touched by the change — never a blind full re-run.
 *  2. detectDrift(prior, current) — compare the prior decision to a freshly-computed
 *     one and report whether it materially DRIFTED (decision, confidence band, or blast
 *     radius changed), with a severity. Drift is what makes a reassessment actionable
 *     (it feeds the S6 workflow recommendations).
 *
 * The worker (later, flag-gated) is: for each plan item → re-run ApplicabilityEngineV1
 * (4a) → persist (4c) → detectDrift vs the prior stored decision → if drifted, derive
 * workflow recommendations (S6). This module is the deterministic linkage logic only.
 */

import type { StoredAssessment } from "./explainability.js";
import type { MatchTargetType } from "./types.js";

/** A change that may invalidate existing applicability decisions. */
export type ChangeEvent =
  | { type: "signal_changed"; signal_id: string }
  | { type: "edge_changed"; organization_id: string; node_type: string; node_id: string }
  | { type: "entity_changed"; organization_id: string; node_type: string; node_id: string };

/** An existing assessment + the blast-radius nodes it touched (for edge/entity matching). */
export interface LinkedAssessment {
  organization_id: string;
  signal_id: string;
  target_type: MatchTargetType;
  target_id: string;
  affected: Array<{ node_type: string; node_id: string }>;
}

export interface ReassessmentItem {
  organization_id: string;
  signal_id: string;
  target_type: MatchTargetType;
  target_id: string;
  reason: string;
}

export interface ReassessmentPlan {
  items: ReassessmentItem[];
}

function itemKey(l: { organization_id: string; signal_id: string; target_type: string; target_id: string }): string {
  return `${l.organization_id}|${l.signal_id}|${l.target_type}|${l.target_id}`;
}

function nodeKey(t: string, i: string): string {
  return `${t}|${i}`;
}

/**
 * Select the assessments that must be re-evaluated for a change event. Deterministic:
 * deduped by (org, signal, target) and sorted by that key.
 */
export function planReassessment(event: ChangeEvent, linked: LinkedAssessment[]): ReassessmentPlan {
  const picked = new Map<string, ReassessmentItem>();

  for (const l of linked) {
    let reason: string | null = null;

    if (event.type === "signal_changed") {
      if (l.signal_id === event.signal_id) reason = "signal_changed";
    } else {
      // edge_changed / entity_changed — org-scoped, touching the target or blast radius.
      if (l.organization_id === event.organization_id) {
        const changed = nodeKey(event.node_type, event.node_id);
        const targetTouched = nodeKey(l.target_type, l.target_id) === changed;
        const radiusTouched = l.affected.some((a) => nodeKey(a.node_type, a.node_id) === changed);
        if (targetTouched || radiusTouched) {
          reason = `${event.type}:${changed}`;
        }
      }
    }

    if (reason) {
      const key = itemKey(l);
      // First reason wins for a given (org,signal,target) — keeps it deterministic.
      if (!picked.has(key)) {
        picked.set(key, {
          organization_id: l.organization_id,
          signal_id: l.signal_id,
          target_type: l.target_type,
          target_id: l.target_id,
          reason
        });
      }
    }
  }

  const items = [...picked.values()].sort((a, b) => (itemKey(a) < itemKey(b) ? -1 : itemKey(a) > itemKey(b) ? 1 : 0));
  return { items };
}

export type DriftKind =
  | "new"
  | "decision_change"
  | "confidence_band_change"
  | "blast_radius_change"
  | "none";

export type DriftSeverity = "high" | "medium" | "low" | "none";

export interface DriftResult {
  drifted: boolean;
  kind: DriftKind;
  severity: DriftSeverity;
  changes: string[];
  added_entities: string[];
  removed_entities: string[];
}

function radiusKeys(a: StoredAssessment): Set<string> {
  return new Set(a.affected_entities.map((e) => nodeKey(e.node_type, e.node_id)));
}

/**
 * Compare a prior stored decision (or null for a first-ever assessment) against a
 * freshly-computed one. Reports the strongest single drift kind + a severity, plus the
 * full change list. Deterministic; the added/removed entity lists are sorted.
 */
export function detectDrift(prior: StoredAssessment | null, current: StoredAssessment): DriftResult {
  if (!prior) {
    // A brand-new decision. It is actionable iff it concludes (potentially) affected.
    const actionable = current.decision === "affected" || current.decision === "potentially_affected";
    return {
      drifted: true,
      kind: "new",
      severity: actionable ? (current.decision === "affected" ? "high" : "medium") : "low",
      changes: [`new assessment: ${current.decision}`],
      added_entities: [...radiusKeys(current)].sort(),
      removed_entities: []
    };
  }

  const changes: string[] = [];

  const decisionChanged = prior.decision !== current.decision;
  const bandChanged = prior.confidence_band !== current.confidence_band;

  const priorR = radiusKeys(prior);
  const currR = radiusKeys(current);
  const added = [...currR].filter((k) => !priorR.has(k)).sort();
  const removed = [...priorR].filter((k) => !currR.has(k)).sort();
  const radiusChanged = added.length > 0 || removed.length > 0;

  if (decisionChanged) changes.push(`decision: ${prior.decision} -> ${current.decision}`);
  if (bandChanged) changes.push(`confidence_band: ${prior.confidence_band} -> ${current.confidence_band}`);
  if (radiusChanged) changes.push(`blast_radius: +${added.length}/-${removed.length}`);

  // Strongest kind wins; severity reflects how consequential the change is.
  let kind: DriftKind = "none";
  let severity: DriftSeverity = "none";
  if (decisionChanged) {
    kind = "decision_change";
    // Crossing the affected boundary in either direction is the highest-signal drift.
    const crossesAffected = prior.decision === "affected" || current.decision === "affected";
    severity = crossesAffected ? "high" : "medium";
  } else if (bandChanged) {
    kind = "confidence_band_change";
    severity = "medium";
  } else if (radiusChanged) {
    kind = "blast_radius_change";
    severity = "medium";
  }

  return {
    drifted: changes.length > 0,
    kind,
    severity,
    changes,
    added_entities: added,
    removed_entities: removed
  };
}
