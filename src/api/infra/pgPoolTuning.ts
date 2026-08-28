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
 * A Render zero-downtime deploy briefly runs the old and new instance of a
 * service side by side, so the worst transient is one extra service's share:
 * 60 + 12 = 72, still inside the budget. At pg's defaults the same transient
 * is 120 > 100 — `FATAL: too many connections` for whichever process connects
 * last, which is the fresh deploy.
 *
 * Knobs (all optional, all validated, invalid → default + warning):
 *
 *   DATABASE_POOL_MAX                       app pool size            (8)
 *   DATABASE_ELEVATED_POOL_MAX              elevated pool size       (4)
 *   DATABASE_CONNECTION_TIMEOUT_MS          wait for a free client   (10000)
 *   DATABASE_IDLE_TIMEOUT_MS                idle client reclaim      (30000)
 *   DATABASE_STATEMENT_TIMEOUT_MS           app statement_timeout    (30000; 0 = off)
 *   DATABASE_ELEVATED_STATEMENT_TIMEOUT_MS  elevated statement_timeout (120000; 0 = off)
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
  /**
   * Server-side `statement_timeout` (ms) sent as a STARTUP parameter on every
   * client this pool opens. 0 = not sent (server default). A statement that
   * outlives its caller is the other way a scarce client gets pinned; a
   * job that legitimately needs longer sets `SET LOCAL statement_timeout`
   * inside its own transaction, which overrides the session value.
   */
  statementTimeoutMillis: number;
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
/**
 * 30s on the application pool — the same figure as the global HTTP request
 * budget (requestTimeoutBudget.test.ts): a statement still running after its
 * request has been 504'd is pure waste holding a client.
 */
export const DEFAULT_APP_STATEMENT_TIMEOUT_MS = 30_000;
/**
 * 120s on the elevated pool. Its callers (ingestion, erasure, the ops health
 * aggregate, operator surfaces) legitimately run longer than a request does,
 * so it is looser — but still bounded, because an elevated client stuck on a
 * runaway statement is the one the workers cannot get back.
 */
export const DEFAULT_ELEVATED_STATEMENT_TIMEOUT_MS = 120_000;

/** Guard rails. A value outside these is a mistake, not a tuning choice. */
const LIMITS = {
  max: { min: 1, max: 100 },
  connectionTimeoutMillis: { min: 250, max: 120_000 },
  idleTimeoutMillis: { min: 1_000, max: 600_000 },
  // 0 is LEGAL here and means "do not send the parameter": a statement
  // timeout is a bound on work, not on waiting, so disabling it is a tuning
  // choice (a bulk backfill) rather than the original defect re-spelled.
  statementTimeoutMillis: { min: 0, max: 3_600_000 },
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
  const statementKey =
    role === "app"
      ? "DATABASE_STATEMENT_TIMEOUT_MS"
      : "DATABASE_ELEVATED_STATEMENT_TIMEOUT_MS";
  const statementDefault =
    role === "app"
      ? DEFAULT_APP_STATEMENT_TIMEOUT_MS
      : DEFAULT_ELEVATED_STATEMENT_TIMEOUT_MS;

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
    statementTimeoutMillis: readPoolOverride(
      env,
      statementKey,
      statementDefault,
      LIMITS.statementTimeoutMillis,
      onInvalid
    ),
  };
}

/**
 * The exact option object spread into the Pool constructor. Every pool
 * construction in this repository goes through here (pgPoolConstructionGuard.test.ts enforces
 * it), so a pool cannot be opened without its bounds. `statement_timeout` is
 * node-postgres' own option name; `false` means "do not send the startup
 * parameter", which is what 0 resolves to.
 */
export function toPoolOptions(t: PoolTuning): {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number | false;
} {
  return {
    max: t.max,
    connectionTimeoutMillis: t.connectionTimeoutMillis,
    idleTimeoutMillis: t.idleTimeoutMillis,
    statement_timeout: t.statementTimeoutMillis === 0 ? false : t.statementTimeoutMillis,
  };
}
