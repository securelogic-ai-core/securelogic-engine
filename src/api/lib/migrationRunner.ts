/**
 * migrationRunner.ts — the transaction body scripts/runMigrations.ts executes
 * for each migration, plus the timeout settings that bound it.
 *
 * Why this lives in src/api/lib and not next to the script: `scripts/**` is in
 * neither tsconfig.prod.json's `include` (so CI never typechecks it) nor
 * vitest.config.ts's `include` (so CI never tests it). The migration runner is
 * the single most consequential piece of code in a deploy — the prod engine's
 * startCommand is `npm run migrate && npm start`, so a migration blocks service
 * start. It should not be the one file with no coverage.
 *
 * WHAT THIS FIXES (BL-1, docs/validation/bl1-migration-lock-exposure.md §5):
 * DDL duration was never the danger. `ALTER TABLE` must first ACQUIRE
 * ACCESS EXCLUSIVE, and while it waits, every later query on that table queues
 * behind it. With no lock_timeout that wait is UNBOUNDED. Measured on the
 * harness: a long read in flight on `findings`, then an ALTER, then an ordinary
 * SELECT — the SELECT blocked 7,989 ms for a 203 ms ALTER. With
 * `SET lock_timeout='2s'` on the DDL session the ALTER failed fast at 2,116 ms
 * and the next reader unblocked in 123 ms.
 *
 * The trade, stated plainly: a contended migration now FAILS THE DEPLOY instead
 * of stalling production. For a boot-blocking migration that is the better
 * failure — it is fast, loud, and retryable, where the stall is silent and
 * unbounded.
 */

/** Minimal shape of a pg client. Structural so tests can pass a fake. */
export interface MigrationQueryClient {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

export interface MigrationTimeouts {
  /** Max wait to ACQUIRE a lock before aborting. Bounds the queue behind DDL. */
  lockTimeout: string;
  /** Max runtime of a single statement. Backstop against a runaway migration. */
  statementTimeout: string;
}

/**
 * 5s: long enough that a migration is not defeated by an ordinary in-flight
 * query, short enough that a reader queued behind DDL is never stalled for more
 * than ~5s. BL-1 recommended 2–5s.
 */
export const DEFAULT_LOCK_TIMEOUT = "5s";

/**
 * 300s: generous. The largest measured migration in the pending set (20260926's
 * backfill) took 6.9s at 250k rows, ~50x under this. It exists to stop a
 * runaway, not to police normal work.
 */
export const DEFAULT_STATEMENT_TIMEOUT = "300s";

/**
 * Postgres accepts no bind parameters in SET, so these values are interpolated
 * into SQL. They come from the environment, which makes validation a security
 * control, not a nicety. Anything not matching this shape is rejected outright
 * rather than escaped.
 *
 * Accepts a bare integer (milliseconds, per Postgres) or an integer with a unit.
 * `0` disables the timeout — permitted, because an operator may need to run an
 * unbounded migration deliberately, but it must be spelled explicitly.
 */
const DURATION_PATTERN = /^(0|[1-9][0-9]*)(ms|s|min|h|d)?$/;

export function validateDuration(raw: string, varName: string): string {
  const value = raw.trim();

  if (!DURATION_PATTERN.test(value)) {
    throw new Error(
      `${varName} is not a valid Postgres duration: ${JSON.stringify(raw)}. ` +
        `Expected an integer with an optional unit (ms, s, min, h, d) — ` +
        `e.g. "5s", "500ms", "0" to disable.`
    );
  }

  return value;
}

export function resolveMigrationTimeouts(
  env: NodeJS.ProcessEnv = process.env
): MigrationTimeouts {
  const lock = env["MIGRATION_LOCK_TIMEOUT"];
  const statement = env["MIGRATION_STATEMENT_TIMEOUT"];

  return {
    lockTimeout: validateDuration(
      lock ?? DEFAULT_LOCK_TIMEOUT,
      "MIGRATION_LOCK_TIMEOUT"
    ),
    statementTimeout: validateDuration(
      statement ?? DEFAULT_STATEMENT_TIMEOUT,
      "MIGRATION_STATEMENT_TIMEOUT"
    ),
  };
}

/** Postgres SQLSTATEs that mean "the timeout did its job". */
export const LOCK_NOT_AVAILABLE = "55P03";
export const QUERY_CANCELED = "57014";

/**
 * Turn a migration failure into a message an operator reads at 3am mid-deploy.
 * A lock timeout is NOT a broken migration — it is a busy database, and the
 * correct response is to retry, not to edit SQL.
 */
export function describeMigrationFailure(
  filename: string,
  err: unknown,
  timeouts: MigrationTimeouts
): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;

  if (code === LOCK_NOT_AVAILABLE) {
    return (
      `Migration ${filename} could not acquire its lock within ` +
      `${timeouts.lockTimeout} and was aborted deliberately (SQLSTATE ` +
      `${LOCK_NOT_AVAILABLE}). Nothing was applied; the transaction rolled ` +
      `back. Another session holds a conflicting lock on a table this ` +
      `migration alters. This is the designed failure — it protects readers ` +
      `from queueing behind the DDL. RETRY the deploy; if it keeps failing, ` +
      `find the long-running session (pg_stat_activity) or raise ` +
      `MIGRATION_LOCK_TIMEOUT for one run.`
    );
  }

  if (code === QUERY_CANCELED) {
    return (
      `Migration ${filename} exceeded MIGRATION_STATEMENT_TIMEOUT ` +
      `(${timeouts.statementTimeout}) and was cancelled (SQLSTATE ` +
      `${QUERY_CANCELED}). Nothing was applied; the transaction rolled back. ` +
      `Either the migration is doing more work than expected at this data ` +
      `volume, or it is stuck. Do NOT simply raise the timeout without ` +
      `understanding which.`
    );
  }

  return `Migration failed: ${filename}`;
}

/**
 * Apply one migration in its own transaction, bounded by both timeouts.
 *
 * SET LOCAL, not SET: the settings are scoped to this transaction and are
 * discarded at COMMIT/ROLLBACK, so a pooled connection never carries them into
 * unrelated work. They are issued AFTER BEGIN (SET LOCAL outside a transaction
 * is a no-op that warns) and BEFORE the migration SQL, so the very first lock
 * the migration takes is already bounded.
 *
 * Ordering note: the schema_migrations INSERT shares the transaction with the
 * DDL, so a timed-out migration is never recorded as applied.
 */
export async function applyMigration(
  client: MigrationQueryClient,
  filename: string,
  sql: string,
  timeouts: MigrationTimeouts
): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(`SET LOCAL lock_timeout = '${timeouts.lockTimeout}'`);
    await client.query(
      `SET LOCAL statement_timeout = '${timeouts.statementTimeout}'`
    );
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
      filename,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
