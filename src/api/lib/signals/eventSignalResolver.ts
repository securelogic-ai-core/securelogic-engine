/**
 * eventSignalResolver.ts — resolve a raw cyber_signal to its canonical
 * Intelligence Event. Intelligence Pipeline Hardening (event-native linkage).
 *
 * The bridge from the INGESTION RECORD (cyber_signals) to the AUTHORITATIVE MODEL
 * (intelligence_events). Primary resolution is the corroboration ledger
 * (cyber_signal_id → event_id); the CVE-primary canonical key is a fallback for
 * signals not (yet) recorded as a contributing source. GLOBAL reads; the caller
 * supplies the client (elevated or the matcher's transaction).
 *
 * Ingestion is unchanged — raw signals remain the ingestion record. This module
 * only lets the customer-facing linkage layer reference the canonical event.
 */

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;

interface ResolverClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Resolve one signal's canonical event id, or null if none exists yet. */
export async function resolveEventIdForSignal(
  client: ResolverClient,
  signalId: string,
  affectedCve: string | null
): Promise<string | null> {
  const bySource = await client.query<{ event_id: string | null }>(
    `SELECT event_id FROM intelligence_event_sources
      WHERE cyber_signal_id = $1 AND event_id IS NOT NULL
      LIMIT 1`,
    [signalId]
  );
  if (bySource.rows[0]?.event_id) return bySource.rows[0].event_id;

  if (affectedCve) {
    const cve = affectedCve.trim().toUpperCase();
    if (CVE_RE.test(cve)) {
      const byKey = await client.query<{ id: string }>(
        `SELECT id FROM intelligence_events WHERE canonical_key = $1 LIMIT 1`,
        [`cve:${cve}`]
      );
      if (byKey.rows[0]?.id) return byKey.rows[0].id;
    }
  }
  return null;
}

/**
 * Batch-resolve many signal ids to their event ids via the corroboration ledger.
 * Returns a Map (signalId → eventId); signals with no event are absent. Used by
 * read APIs to resolve legacy signal-keyed rows through canonical events.
 */
export async function resolveEventIdsForSignals(
  client: ResolverClient,
  signalIds: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (signalIds.length === 0) return out;
  const rows = (
    await client.query<{ cyber_signal_id: string; event_id: string }>(
      `SELECT DISTINCT ON (cyber_signal_id) cyber_signal_id, event_id
         FROM intelligence_event_sources
        WHERE cyber_signal_id = ANY($1) AND event_id IS NOT NULL
        ORDER BY cyber_signal_id, first_contributed_at ASC`,
      [signalIds as string[]]
    )
  ).rows;
  for (const r of rows) out.set(r.cyber_signal_id, r.event_id);
  return out;
}
