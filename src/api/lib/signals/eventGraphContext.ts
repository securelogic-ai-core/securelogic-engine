/**
 * eventGraphContext.ts — canonical Intelligence Events as the graph-ask
 * intelligence source. Intelligence Pipeline Hardening (item 3).
 *
 * The Knowledge Graph "ask" grounds an LLM answer in graph evidence; this module
 * supplies the CANONICAL EVENTS relevant to the graph neighbourhood (events whose
 * affected vendor appears among the neighbourhood's vendor labels) so the answer
 * reasons over deduplicated, normalized intelligence — not raw signals. GLOBAL
 * reads (elevated). Pure helper for extracting vendor names from labels.
 */

import { pgElevated } from "../../infra/postgres.js";

export interface EventContext {
  readonly canonical_key: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly confidence: number;
  readonly affected_vendor: string | null;
}

/** Distinct, lowercased vendor names from a set of candidate labels. */
export function vendorNamesFromLabels(labels: readonly (string | null)[]): string[] {
  const out = new Set<string>();
  for (const l of labels) {
    if (typeof l === "string" && l.trim() !== "") out.add(l.trim().toLowerCase());
  }
  return [...out];
}

/**
 * Fetch canonical events (global) whose affected vendor is in `vendorNames`,
 * newest + most-severe first. Archived events excluded. Empty input → [].
 */
export async function fetchEventsForVendors(vendorNames: readonly string[], limit = 20): Promise<EventContext[]> {
  if (vendorNames.length === 0) return [];
  const bounded = Math.min(50, Math.max(1, limit));
  const res = await pgElevated.query<EventContext>(
    `SELECT canonical_key, title, severity, status, confidence, affected_vendor
       FROM intelligence_events
      WHERE affected_vendor IS NOT NULL
        AND lower(trim(affected_vendor)) = ANY($1)
        AND status <> 'archived'
      ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,
               last_seen_at DESC
      LIMIT $2`,
    [vendorNames, String(bounded)]
  );
  return res.rows;
}
