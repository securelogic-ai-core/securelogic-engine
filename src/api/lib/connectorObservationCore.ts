/**
 * connectorObservationCore.ts — ERIP Epic 2 (E2.P2): the PURE observation
 * plane (ERIP-AD-8). Derives the discovery-fact rows a sync run must upsert
 * into connector_asset_observations from the (already pure) sync plan.
 * NO I/O — fully unit-testable; the worker owns persistence.
 */

import type { ConnectorSyncPlan } from "./connectorSyncCore.js";
import type { ImportEntityType, ImportRow } from "./enterpriseContextImport.js";

/** One discovery fact: this connector reported this external_ref as this thing. */
export interface ObservationInput {
  external_ref: string;
  /** Which persistence lane the plan routed the entity to. */
  lane: "detail" | "import";
  /** detail lane → detail asset_type; import lane → ECL import entity_type. */
  entity_type: string;
  name: string;
}

/**
 * Map a sync plan to its observation upserts. Deterministic; deduped by
 * external_ref (first occurrence wins — the plan is already deterministic).
 */
export function planObservations(plan: ConnectorSyncPlan): ObservationInput[] {
  const out: ObservationInput[] = [];
  const seen = new Set<string>();

  for (const d of plan.detailInputs) {
    const ref = d.external_ref;
    if (typeof ref !== "string" || ref.length === 0 || seen.has(ref)) continue;
    seen.add(ref);
    out.push({ external_ref: ref, lane: "detail", entity_type: d.asset_type, name: d.name });
  }

  for (const [entityType, rows] of Object.entries(plan.importGroups) as Array<[ImportEntityType, ImportRow[]]>) {
    for (const row of rows) {
      const ref = row.external_ref;
      if (typeof ref !== "string" || ref.length === 0 || seen.has(ref)) continue;
      if (typeof row.name !== "string" || row.name.length === 0) continue;
      seen.add(ref);
      out.push({ external_ref: ref, lane: "import", entity_type: entityType, name: row.name });
    }
  }

  return out;
}
