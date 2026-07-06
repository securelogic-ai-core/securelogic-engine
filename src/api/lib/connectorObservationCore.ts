/**
 * connectorObservationCore.ts — ERIP Epic 2 (E2.P2): the PURE observation
 * plane (ERIP-AD-8). Derives the discovery-fact rows a sync run must upsert
 * into connector_asset_observations from the (already pure) sync plan.
 * NO I/O — fully unit-testable; the worker owns persistence.
 */

import type { ConnectorSyncPlan } from "./connectorSyncCore.js";
import type { ImportEntityType, ImportRow } from "./enterpriseContextImport.js";
import type { NormalizedInventory } from "./connectors/types.js";

/** One discovery fact: this connector reported this external_ref as this thing. */
export interface ObservationInput {
  external_ref: string;
  /** Which persistence lane the plan routed the entity to. */
  lane: "detail" | "import";
  /** detail lane → detail asset_type; import lane → ECL import entity_type. */
  entity_type: string;
  name: string;
  /** E2.P4 (ERIP-AD-13): discovered owner (suggest-only). */
  owner_hint: string | null;
  /** E2.P4: source-echo metadata; null when the source reports none. */
  metadata: Record<string, string> | null;
}

/**
 * Map a sync plan to its observation upserts. Deterministic; deduped by
 * external_ref (first occurrence wins — the plan is already deterministic).
 * The optional `inventory` supplies E2.P4 owner_hint/metadata by external_ref
 * (the plan drops them on the way to detail/import inputs); omit it and those
 * fields are null.
 */
export function planObservations(plan: ConnectorSyncPlan, inventory?: NormalizedInventory): ObservationInput[] {
  const enrich = new Map<string, { owner_hint: string | null; metadata: Record<string, string> | null }>();
  if (inventory) {
    for (const e of inventory.entities) {
      if (typeof e.external_ref !== "string" || e.external_ref.length === 0) continue;
      const owner_hint = typeof e.owner_hint === "string" && e.owner_hint.trim().length > 0 ? e.owner_hint.trim() : null;
      const metadata = e.metadata && Object.keys(e.metadata).length > 0 ? e.metadata : null;
      if (owner_hint !== null || metadata !== null) enrich.set(e.external_ref, { owner_hint, metadata });
    }
  }
  const enrichOf = (ref: string) => enrich.get(ref) ?? { owner_hint: null, metadata: null };

  const out: ObservationInput[] = [];
  const seen = new Set<string>();

  for (const d of plan.detailInputs) {
    const ref = d.external_ref;
    if (typeof ref !== "string" || ref.length === 0 || seen.has(ref)) continue;
    seen.add(ref);
    out.push({ external_ref: ref, lane: "detail", entity_type: d.asset_type, name: d.name, ...enrichOf(ref) });
  }

  for (const [entityType, rows] of Object.entries(plan.importGroups) as Array<[ImportEntityType, ImportRow[]]>) {
    for (const row of rows) {
      const ref = row.external_ref;
      if (typeof ref !== "string" || ref.length === 0 || seen.has(ref)) continue;
      if (typeof row.name !== "string" || row.name.length === 0) continue;
      seen.add(ref);
      out.push({ external_ref: ref, lane: "import", entity_type: entityType, name: row.name, ...enrichOf(ref) });
    }
  }

  return out;
}
