/**
 * discoveryConfidence.ts — ERIP Epic 2 (E2.P3): PURE conflict-resolution +
 * confidence scoring over connector observations (ERIP-AD-12). No I/O — the
 * route gathers the observation rows for an asset and passes them here.
 *
 * ERIP-AD-8 holds: this NEVER mutates canonical stores. It derives, read-side,
 * (a) the effective value of each discovered field via source precedence then
 * recency, and (b) a 0–100 confidence from source count, agreement, staleness,
 * and recency. Canonical (human-set) values are not represented here — they
 * live in the canonical tables and always win at the product layer.
 */

/** One observation row as the discovery reader hands it to the pure core. */
export interface ObservationFact {
  connector_id: string;
  /** Category rank source of truth for precedence. */
  category: ConnectorCategory;
  external_ref: string;
  entity_type: string;
  name: string;
  stale: boolean;
  /** ISO timestamp; newer wins ties within equal precedence. */
  last_seen_at: string;
  /** E2.P4: discovered owner (suggest-only), or null. */
  owner_hint?: string | null;
  /** E2.P4: source-echo metadata, or null. */
  metadata?: Record<string, string> | null;
}

export type ConnectorCategory = "cmdb" | "endpoint" | "vulnerability" | "cloud" | "identity";

/**
 * Per-field source precedence (ERIP-AD-12). A CMDB is the system of record for
 * identity/classification; scanners (endpoint/vuln) are authoritative for
 * technical state. Higher rank wins; recency breaks ties. Deterministic — the
 * ordering is fixed config, never data-driven.
 */
const CATEGORY_RANK: Record<ConnectorCategory, number> = {
  cmdb: 5,
  cloud: 4,
  endpoint: 3,
  vulnerability: 2,
  identity: 1
};

export interface EffectiveField<T> {
  value: T;
  winning_connector: string;
  /** True when sources disagreed and precedence/recency picked one. */
  contested: boolean;
}

export interface DiscoverySummary {
  /** Distinct connectors that observed this asset. */
  source_count: number;
  sources: string[];
  /** 0–100. */
  confidence: number;
  /** True when every observation for the asset is stale. */
  fully_stale: boolean;
  /** True when at least one observation is stale. */
  partially_stale: boolean;
  effective_name: EffectiveField<string> | null;
  effective_entity_type: EffectiveField<string> | null;
  /** E2.P4 (ERIP-AD-13): the precedence-resolved discovered owner (suggest-only). */
  effective_owner_hint: EffectiveField<string> | null;
  /** E2.P4: source-echo metadata merged across sources (higher-precedence keys win). */
  metadata: Record<string, string>;
}

/**
 * Pick the winning fact for a field: highest category rank, newest on ties.
 * Callers guarantee a non-empty input (both call sites short-circuit empty).
 */
function pickWinner(facts: readonly ObservationFact[]): ObservationFact {
  const sorted = [...facts].sort((a, b) => {
    const r = CATEGORY_RANK[b.category] - CATEGORY_RANK[a.category];
    if (r !== 0) return r;
    if (a.last_seen_at !== b.last_seen_at) return a.last_seen_at < b.last_seen_at ? 1 : -1;
    // Final deterministic tiebreak so equal-rank equal-time is stable.
    return a.connector_id < b.connector_id ? -1 : a.connector_id > b.connector_id ? 1 : 0;
  });
  const winner = sorted[0];
  if (!winner) throw new Error("pickWinner called with no facts");
  return winner;
}

function effectiveField(
  facts: readonly ObservationFact[],
  get: (f: ObservationFact) => string
): EffectiveField<string> | null {
  if (facts.length === 0) return null;
  const winner = pickWinner(facts);
  const distinct = new Set(facts.map(get));
  return { value: get(winner), winning_connector: winner.connector_id, contested: distinct.size > 1 };
}

/**
 * Confidence heuristic (ERIP-AD-12), deterministic and bounded 0–100:
 *   base 50 for a single fresh source,
 *   +20 per additional distinct source (corroboration), capped at +40,
 *   +10 when all sources agree on the name (no contest),
 *   −25 when the winning fact is stale, −40 when every source is stale.
 * `now` is injected (no Date.now in this pure module).
 */
export function computeConfidence(facts: readonly ObservationFact[], now: Date): number {
  if (facts.length === 0) return 0;
  const sources = new Set(facts.map((f) => f.connector_id));
  const nameField = effectiveField(facts, (f) => f.name);
  const winner = pickWinner(facts);
  const allStale = facts.every((f) => f.stale);

  let score = 50;
  score += Math.min((sources.size - 1) * 20, 40);
  if (nameField && !nameField.contested) score += 10;
  if (allStale) score -= 40;
  else if (winner.stale) score -= 25;

  // Recency decay: −10 once the winning fact is older than 30 days.
  const ageDays = (now.getTime() - new Date(winner.last_seen_at).getTime()) / 86_400_000;
  if (ageDays > 30) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Merge source-echo metadata across facts: iterate low→high precedence so the
 * highest-precedence source's keys land last and win. Deterministic.
 */
function mergeMetadata(facts: readonly ObservationFact[]): Record<string, string> {
  const ordered = [...facts].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
  const out: Record<string, string> = {};
  for (const f of ordered) {
    if (!f.metadata) continue;
    for (const [k, v] of Object.entries(f.metadata)) out[k] = v;
  }
  return out;
}

/** Full read-side discovery summary for one asset's observation set. */
export function summarizeDiscovery(facts: readonly ObservationFact[], now: Date): DiscoverySummary {
  const sources = [...new Set(facts.map((f) => f.connector_id))].sort();
  const withOwner = facts.filter((f): f is ObservationFact & { owner_hint: string } =>
    typeof f.owner_hint === "string" && f.owner_hint.length > 0
  );
  return {
    source_count: sources.length,
    sources,
    confidence: computeConfidence(facts, now),
    fully_stale: facts.length > 0 && facts.every((f) => f.stale),
    partially_stale: facts.some((f) => f.stale),
    effective_name: effectiveField(facts, (f) => f.name),
    effective_entity_type: effectiveField(facts, (f) => f.entity_type),
    effective_owner_hint: effectiveField(withOwner, (f) => f.owner_hint ?? ""),
    metadata: mergeMetadata(facts)
  };
}
