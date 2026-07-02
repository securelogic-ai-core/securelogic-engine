/**
 * Source reliability scorer — Priority 4 / Phase 4B / slice B3 (Option S).
 *
 * Derives a rolling-ish `reliability` (0–100) for each upstream source from the
 * GLOBAL `feed_health` snapshot and persists it into `sources.reliability`
 * (column + 0–100 CHECK already exist from B1; NULL until populated here).
 *
 * Option S (snapshot-proxy): `feed_health` is a one-row-per-source STATE
 * snapshot, not an append-only event log — there is no retained attempt history
 * to window over. So reliability is a deterministic function of the current
 * snapshot (`consecutive_failures` + age of `last_success_at`), NOT a true
 * windowed success ratio. Higher-fidelity history (a `feed_health_events` table)
 * is a deliberately deferred, separately-scoped upgrade; because reliability is
 * a DERIVED value persisted only in `sources.reliability`, that upgrade would
 * change only this scorer's inputs, never any downstream consumer.
 *
 * SINGLE SOURCE OF TRUTH: the formula lives here, in TypeScript, and nowhere
 * else — no SQL duplicate, no TS constant table of pre-baked values. The value
 * is recomputed-and-overwritten into the table; it is never accumulated.
 *
 * SCOPE — B3 ships the scorer + an on-demand writer ONLY. Nothing consumes
 * `reliability` yet (ranking is slice B4, behind
 * SECURELOGIC_SOURCE_QUALIFICATION_ENABLED, reading the table) and nothing
 * invokes the writer automatically (the recompute trigger is deferred to B4).
 * No fetch / ingestion / scheduler / matcher / brief behavior changes here.
 *
 * Tenancy: GLOBAL. Reads `feed_health` (no organization_id) and writes
 * `sources.reliability` (no organization_id). No RLS, no per-org data — the same
 * posture as feedHealth.ts.
 */

/** Decay applied per consecutive failure: reliability *= BASE^consecutive_failures. */
export const RELIABILITY_FAILURE_DECAY_BASE = 0.6;

/**
 * Light staleness taper. The factor falls linearly from 1.0 (fresh success) to
 * RELIABILITY_STALENESS_FLOOR once the last success is RELIABILITY_STALENESS_
 * HORIZON_DAYS or older. "Light" by design — a very stale source loses at most
 * (1 - FLOOR), so failures (the decay above) dominate the score, not age.
 */
export const RELIABILITY_STALENESS_FLOOR = 0.7;
export const RELIABILITY_STALENESS_HORIZON_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/**
 * The minimal `feed_health` fields the scorer reads. A source with NO feed_health
 * row is represented as `null` (cold-start) by the caller, not by this shape.
 */
export interface FeedHealthSnapshot {
  /** `feed_health.consecutive_failures` (NOT NULL, ≥ 0; reset to 0 on any success). */
  readonly consecutiveFailures: number;
  /** `feed_health.last_success_at` (NULL ⇒ the source has only ever failed). */
  readonly lastSuccessAt: Date | null;
}

/** Round to 2 decimals so the result fits `sources.reliability NUMERIC(5,2)`. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Light, monotonic staleness factor in [FLOOR, 1.0] from the age of the last success. */
function stalenessFactor(lastSuccessAt: Date | null, now: Date): number {
  if (lastSuccessAt === null) return RELIABILITY_STALENESS_FLOOR;
  const ageDays = Math.max(0, (now.getTime() - lastSuccessAt.getTime()) / MS_PER_DAY);
  const t = Math.min(ageDays, RELIABILITY_STALENESS_HORIZON_DAYS) / RELIABILITY_STALENESS_HORIZON_DAYS;
  return 1 - (1 - RELIABILITY_STALENESS_FLOOR) * t;
}

/**
 * Compute a source's reliability in [0,100], or `null` for cold-start.
 *
 *   reliability = 100 × (DECAY_BASE ^ consecutive_failures) × stalenessFactor(last_success_at)
 *
 * Deterministic given `(snapshot, now)`. `now` is injected so the result is
 * fully testable and free of ambient clock reads.
 *
 * @param snapshot the source's `feed_health` snapshot, or `null` if it has no
 *   `feed_health` row yet (cold-start / never attempted).
 * @param now reference time for the staleness taper.
 * @returns reliability 0–100 (2dp), or `null` for cold-start ("unknown" — B4
 *   falls back to static authority rather than treating it as 0).
 */
export function computeReliability(
  snapshot: FeedHealthSnapshot | null,
  now: Date
): number | null {
  if (snapshot === null) return null; // cold-start ⇒ unknown, NOT zero
  const cf = Math.max(0, snapshot.consecutiveFailures);
  const decay = RELIABILITY_FAILURE_DECAY_BASE ** cf;
  const raw = 100 * decay * stalenessFactor(snapshot.lastSuccessAt, now);
  return round2(Math.min(100, Math.max(0, raw)));
}

/** Minimal client surface so the writer is injectable + unit-testable (pg Pool satisfies it). */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

/** Per-source recompute outcome (for logging by the on-demand operator script). */
export interface ReliabilityRecomputeResult {
  readonly total: number;
  readonly updated: number;
}

/**
 * Recompute `reliability` for EVERY source in `sources`, from the GLOBAL
 * `feed_health` snapshot, and write it back. Sources with no `feed_health` row
 * (cold-start) are set to NULL = unknown.
 *
 * On-demand only in B3 — the caller (the operator script) decides when to run
 * it; nothing in the app runtime invokes this. The automatic recompute trigger
 * is slice B4. Uses a GLOBAL elevated client supplied by the caller — this
 * module imports no infra, so importing it constructs no pool and reads no env.
 *
 * @param db an elevated/global Postgres client (e.g. `pgElevated`).
 * @param now reference time for the staleness taper (defaults to current time).
 */
export async function recomputeSourceReliability(
  db: Queryable,
  now: Date = new Date()
): Promise<ReliabilityRecomputeResult> {
  // LEFT JOIN so a source with no feed_health row surfaces as cf = NULL (cold-start).
  // GLOBAL only — neither table carries organization_id; no tenant scoping exists.
  const { rows } = await db.query<{
    source: string;
    consecutive_failures: number | null;
    last_success_at: Date | string | null;
  }>(
    `SELECT s.source                AS source,
            fh.consecutive_failures AS consecutive_failures,
            fh.last_success_at      AS last_success_at
       FROM sources s
       LEFT JOIN feed_health fh ON fh.source = s.source`
  );

  let updated = 0;
  for (const row of rows) {
    const snapshot: FeedHealthSnapshot | null =
      row.consecutive_failures === null || row.consecutive_failures === undefined
        ? null
        : {
            consecutiveFailures: Number(row.consecutive_failures),
            lastSuccessAt:
              row.last_success_at === null || row.last_success_at === undefined
                ? null
                : new Date(row.last_success_at)
          };

    const reliability = computeReliability(snapshot, now);
    await db.query(
      `UPDATE sources SET reliability = $1, updated_at = NOW() WHERE source = $2`,
      [reliability, row.source]
    );
    updated += 1;
  }

  return { total: rows.length, updated };
}
