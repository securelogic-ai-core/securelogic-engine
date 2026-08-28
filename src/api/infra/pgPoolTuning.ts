/**
 * pgPoolTuning.ts — connection-pool bounds for every `pg` Pool this service
 * opens (PLATFORM-R1 item R1-1).
 *
 * THE DEFECT THIS EXISTS TO CLOSE
 * -------------------------------
 * Both application pools were constructed as `new Pool({ connectionString,
 * ssl })`, taking node-postgres' defaults wholesale. Two of those defaults are
 * wrong for this deployment:
 *
 *   connectionTimeoutMillis: 0   -> wait FOREVER for a free connection
 *   max: 10                      -> per pool, per process, unbounded in aggregate
 *
 * `0` does not mean "no timeout is needed", it means a request that arrives
 * when the pool is saturated hangs until something else releases — with no
 * error, no log line, and no metric. Pool exhaustion presents as a service
 * that has stopped responding while every health check still passes, which is
 * the hardest possible failure to diagnose and the slowest to page on.
 *
 * THE AGGREGATE PROBLEM, MEASURED
 * -------------------------------
 * Measured against the live Render Postgres (`basic_256mb`, the plan
 * production runs) on 2026-08-28:
 *
 *   max_connections                = 103
 *   superuser_reserved_connections =   3
 *   -> usable                      = 100
 *
 * Five services connect to that database in production (engine, intelligence,
 * posture, data-rights and vendor-extraction workers). Each opens TWO pools —
 * the application pool and `pgElevated`. At node-postgres' default of 10:
 *
 *   5 services x 2 pools x 10 = 100 connections = 100% of the budget
 *
 * The defaults are sized to consume the entire database exactly, leaving
 * nothing for the migration channel (MIGRATION_DATABASE_URL), `render psql`,
 * or the Render dashboard. Nobody chose that number; it is what you get by
 * not choosing.
 *
 * THE BUDGET SET HERE
 * -------------------
 *   5 services x (8 + 4) = 60 connections, ~40 held in reserve.
 *
 * `pgElevated` gets the smaller share deliberately: it is the cross-tenant
 * channel used by ingestion, admin surfaces and signup, not the request path,
 * and it is lazy — with no callers it opens nothing. The application pool
 * carries request concurrency and gets the larger share.
 *
 * Every value is env-overridable because the right number is a property of the
 * deployment, not of the code: a larger DB plan, a second engine instance, or
 * a sixth worker all move it. Overrides are validated and fall back to the
 * default rather than throwing — a typo in an env var must not prevent the
 * service from starting, and the safe default is a bounded pool.
 */

export interface PoolTuning {
  /** Maximum clients this pool will open. */
  max: number;
  /**
   * How long a caller waits for a free client before failing. NEVER 0 — that
   * is the unbounded wait this module exists to prevent.
   */
  connectionTimeoutMillis: number;
  /** How long an unused client stays open before being released. */
  idleTimeoutMillis: number;
}

/** Application (request-path) pool. Carries request concurrency. */
export const DEFAULT_APP_POOL_MAX = 8;
/** Elevated (cross-tenant) pool. Ingestion, admin, signup — not the request path. */
export const DEFAULT_ELEVATED_POOL_MAX = 4;
/**
 * 10s. Long enough to ride out a brief burst, short enough that saturation
 * surfaces as a fast, logged, attributable error instead of a silent hang.
 */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
/** 30s. Releases idle clients back to the database between traffic bursts. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/** Guard rails. A value outside these is a mistake, not a tuning choice. */
const LIMITS = {
  max: { min: 1, max: 100 },
  connectionTimeoutMillis: { min: 250, max: 120_000 },
  idleTimeoutMillis: { min: 1_000, max: 600_000 },
} as const;

/**
 * Read a positive-integer env override, or return the default.
 *
 * Returns the default for absent, empty, non-numeric, non-integer, negative,
 * zero and out-of-range values. Zero is rejected for EVERY key, not just the
 * timeout: `max: 0` is a pool that can never serve, and
 * `connectionTimeoutMillis: 0` is the original defect spelled by hand.
 */
export function readPoolOverride(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  limits: { min: number; max: number },
  onInvalid?: (detail: { key: string; raw: string; reason: string }) => void
): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") return fallback;

  const n = Number(raw);
  let reason: string | null = null;
  if (!Number.isFinite(n)) reason = "not_a_number";
  else if (!Number.isInteger(n)) reason = "not_an_integer";
  else if (n < limits.min) reason = `below_min_${limits.min}`;
  else if (n > limits.max) reason = `above_max_${limits.max}`;

  if (reason) {
    onInvalid?.({ key, raw, reason });
    return fallback;
  }
  return n;
}

/**
 * Resolve tuning for one pool.
 *
 * `role` selects the default max; both pools share the timeout settings
 * because a caller blocked on either one is blocked the same way.
 */
export function resolvePoolTuning(
  role: "app" | "elevated",
  env: NodeJS.ProcessEnv = process.env,
  onInvalid?: (detail: { key: string; raw: string; reason: string }) => void
): PoolTuning {
  const maxKey =
    role === "app" ? "DATABASE_POOL_MAX" : "DATABASE_ELEVATED_POOL_MAX";
  const maxDefault =
    role === "app" ? DEFAULT_APP_POOL_MAX : DEFAULT_ELEVATED_POOL_MAX;

  return {
    max: readPoolOverride(env, maxKey, maxDefault, LIMITS.max, onInvalid),
    connectionTimeoutMillis: readPoolOverride(
      env,
      "DATABASE_CONNECTION_TIMEOUT_MS",
      DEFAULT_CONNECTION_TIMEOUT_MS,
      LIMITS.connectionTimeoutMillis,
      onInvalid
    ),
    idleTimeoutMillis: readPoolOverride(
      env,
      "DATABASE_IDLE_TIMEOUT_MS",
      DEFAULT_IDLE_TIMEOUT_MS,
      LIMITS.idleTimeoutMillis,
      onInvalid
    ),
  };
}
