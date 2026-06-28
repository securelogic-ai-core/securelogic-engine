/**
 * Brief-item provenance — Priority 4 / Phase 4D / slice D2.
 *
 * Builds the intelligence_brief_item_provenance edge rows for a persisted brief
 * item: one row per contributing cyber_signal (the canonical signal +
 * everything a cluster collapsed into it), tagged `canonical` or `corroborating`.
 *
 * GLOBAL signals, ORG-scoped rows: organization_id is the brief's org (passed
 * in, never derived from the global signal). The caller writes these inside the
 * existing withTenant() savepoint transaction, so RLS is satisfied and the edges
 * are atomic with the brief items.
 */

/** Feature flag for the provenance writes. OFF everywhere by default. */
export function briefProvenanceEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_BRIEF_PROVENANCE_ENABLED"] === "true";
}

/** A provenance edge ready to insert (column order matches the INSERT). */
export interface ProvenanceRow {
  readonly organization_id: string;
  readonly brief_item_id: string;
  readonly cyber_signal_id: string;
  readonly source_slug: string | null;
  readonly cluster_key: string | null;
  readonly relation: "canonical" | "corroborating";
}

/** The brief-item fields the edge builder needs. */
export interface ProvenanceItemInput {
  readonly cyber_signal_id: string;
  readonly source_slug: string | null;
  readonly contributing_signal_ids?: string[];
}

/**
 * Build the provenance edges for one persisted brief item. The canonical signal
 * (`item.cyber_signal_id`) gets relation `canonical`; every other contributing
 * signal gets `corroborating`. `clusterKey` is the brief item's cluster key (or
 * null). Returns [] when there is no canonical signal id.
 */
export function buildProvenanceRows(
  item: ProvenanceItemInput,
  briefItemId: string,
  organizationId: string,
  clusterKey: string | null,
  sourceById?: ReadonlyMap<string, string | null>
): ProvenanceRow[] {
  const canonicalId = item.cyber_signal_id;
  if (!canonicalId) return [];

  // Lineage = the contributing set if present, else just the canonical signal.
  const ids =
    item.contributing_signal_ids && item.contributing_signal_ids.length > 0
      ? item.contributing_signal_ids
      : [canonicalId];

  const rows: ProvenanceRow[] = [];
  const seen = new Set<string>();
  for (const signalId of ids) {
    if (!signalId || seen.has(signalId)) continue;
    seen.add(signalId);
    rows.push({
      organization_id: organizationId,
      brief_item_id: briefItemId,
      cyber_signal_id: signalId,
      // Canonical keeps the item's own source; corroborating uses the per-signal
      // source map when available, else null (denormalised, purge-safe).
      source_slug:
        signalId === canonicalId
          ? item.source_slug
          : sourceById?.get(signalId) ?? null,
      cluster_key: clusterKey,
      relation: signalId === canonicalId ? "canonical" : "corroborating"
    });
  }
  return rows;
}
