/**
 * Source qualification ranking — Priority 4 / Phase 4B / slice B4.
 *
 * Combines the STATIC authority (B2: sources.authority_tier) with the ROLLING
 * reliability (B3: sources.reliability) into the brief pipeline's factor-4
 * "source credibility" ordinal — replacing the hardcoded `sourcePriority` map
 * ONLY when the feature flag is on. Factors 1/2/3/5 of the brief ranking
 * (KEV → severity → has-CVE → … → recency) are untouched.
 *
 * FLAG-GATED (`SECURELOGIC_SOURCE_QUALIFICATION_ENABLED`): when off, the brief
 * generator/scheduler use the legacy `sourcePriority` and behavior is identical
 * to pre-B4. Default is OFF in every environment (including dev/test) — this
 * mutates brief ordering, so it is deliberate opt-in, enabled in staging first.
 *
 * SINGLE SOURCE OF TRUTH: qualification is READ from the global `sources` table
 * (B2 authority + B3 reliability). No values are duplicated here.
 *
 * Tenancy: GLOBAL. `sources` has no organization_id and no RLS; qualification is
 * identical for every org. The per-org brief signal filter is unchanged — no
 * per-org data enters scoring.
 *
 * SOURCE-ID ALIGNMENT (deferred, decision #5 — "not B4"): qualification is keyed
 * by `sources.source` (the canonical underscore ids: cisa_kev, nvd, …). A brief
 * item is matched by its `source_slug` (== `cyber_signals.source`) using the
 * SAME `toLowerCase().trim()` normalization the legacy `sourcePriority` applies.
 * Any source NOT present in the map (unknown id, or an id whose spelling differs
 * from the canonical set) falls back to the legacy ordinal — so a mismatch is a
 * no-op, never a regression. Reconciling `cyber_signals.source` spellings with
 * the registry is a separate, later slice.
 */

/** Reads `env["SECURELOGIC_SOURCE_QUALIFICATION_ENABLED"] === "true"` — OFF everywhere by default. */
export function sourceQualificationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_SOURCE_QUALIFICATION_ENABLED"] === "true";
}

/** One source's qualification, as read from the `sources` table. */
export interface QualificationRecord {
  /** sources.authority_tier — 1 (most authoritative) … 5. */
  readonly authorityTier: number;
  /** sources.reliability — 0–100, or null for cold-start (unknown). */
  readonly reliability: number | null;
}

/** Minimal client surface so the loader is injectable + unit-testable (pg Pool satisfies it). */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

/** Normalize a source id the same way the legacy `sourcePriority` does. */
function normalizeSourceId(source: string): string {
  return source.toLowerCase().trim();
}

/**
 * Load the qualification of every QUALIFIED source (authority_tier present) from
 * the global `sources` table, keyed by normalized source id. Global-only query —
 * no organization_id, no tenant scoping.
 */
export async function loadSourceQualification(
  db: Queryable
): Promise<Map<string, QualificationRecord>> {
  const { rows } = await db.query<{
    source: string;
    authority_tier: number | null;
    reliability: number | string | null;
  }>(
    `SELECT source, authority_tier, reliability
       FROM sources
      WHERE authority_tier IS NOT NULL`
  );

  const map = new Map<string, QualificationRecord>();
  for (const r of rows) {
    if (r.authority_tier === null || r.authority_tier === undefined) continue;
    map.set(normalizeSourceId(r.source), {
      authorityTier: Number(r.authority_tier),
      reliability:
        r.reliability === null || r.reliability === undefined
          ? null
          : Number(r.reliability)
    });
  }
  return map;
}

/**
 * Build the factor-4 priority function (lower = better) from a loaded
 * qualification map, falling back to `legacy` for any unmapped source.
 *
 *   priority = authority_tier − reliability/1000
 *
 * - authority_tier dominates (a tier-1 source always outranks a tier-2 source,
 *   regardless of reliability — the reliability term is < 0.1).
 * - within a tier, higher reliability sorts earlier (smaller priority).
 * - reliability === null (cold-start) ⇒ authority-only, no penalty.
 * - unmapped/unknown source ⇒ legacy ordinal (no coverage loss, no regression).
 */
export function makeQualificationPriority(
  map: Map<string, QualificationRecord>,
  legacy: (source: string) => number
): (source: string) => number {
  return (source: string) => {
    const rec = map.get(normalizeSourceId(source));
    if (!rec) return legacy(source);
    if (rec.reliability === null) return rec.authorityTier;
    return rec.authorityTier - rec.reliability / 1000;
  };
}
