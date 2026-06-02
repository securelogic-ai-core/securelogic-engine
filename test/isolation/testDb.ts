/**
 * testDb.ts — disposable Postgres bootstrap for the cross-org isolation
 * harness (audit finding E1-G1).
 *
 * bootstrapTestDb():
 *   1. Drops and recreates the `public` schema so every run is deterministic.
 *   2. Applies every migration in db/migrations/ in filename order — the same
 *      order scripts/runMigrations.ts uses — reconstructing the full prod
 *      schema, so the harness exercises real tables, constraints and indexes.
 *   3. Seeds two organizations (A and B), each with one active API key.
 *
 * Target DB is TEST_DATABASE_URL. This is a *throwaway* database — never
 * point it at staging or production. CI provisions a Postgres service
 * container; locally, scripts/harness-db-up.sh starts one in Docker.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { Pool } from "pg";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

export interface SeededOrg {
  /** organizations.id */
  id: string;
  /** Raw API key string — send as the `X-Api-Key` header. */
  apiKey: string;
}

export interface TestDbSeed {
  orgA: SeededOrg;
  orgB: SeededOrg;
}

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start a throwaway Postgres with " +
        "scripts/harness-db-up.sh and export TEST_DATABASE_URL.",
    );
  }
  if (/staging|prod/i.test(url)) {
    throw new Error(
      "TEST_DATABASE_URL looks like a staging/production database — refusing " +
        "to drop its schema. Point it at a throwaway database only.",
    );
  }
  return url;
}

/** sha256 hex of the raw key — matches requireApiKey's lookup. */
function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function resetSchema(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

async function applyOne(pool: Pool, file: string): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    // Roll back before returning the connection to the pool — otherwise the
    // next caller inherits an aborted transaction.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply every migration. Files are tried in filename order, but a from-scratch
 * rebuild cannot rely on filename order alone: some migrations carry a
 * filename date that predates the migration they depend on (e.g.
 * 20260504_user_alert_preferences_org_scope.sql ALTERs a table that
 * 20260522_alert_preferences.sql CREATEs). Production is unaffected — it
 * accreted migrations in commit order and schema_migrations recorded that —
 * but a clean rebuild fails. So this runner makes repeated passes: any
 * migration that fails is retried after the rest. If a pass applies nothing,
 * the remaining failures are a genuine error and are surfaced.
 *
 * `deferred` lists migrations that only applied on a retry pass — i.e. those
 * whose filename order is wrong. It is logged so the harness surfaces the
 * ordering defect rather than silently papering over it.
 */
async function applyMigrations(
  pool: Pool,
): Promise<{ count: number; deferred: string[] }> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let pending = files;
  const deferred: string[] = [];
  let pass = 0;

  while (pending.length > 0) {
    pass += 1;
    const failed: string[] = [];
    let appliedThisPass = 0;
    let lastError = "";

    for (const file of pending) {
      try {
        await applyOne(pool, file);
        appliedThisPass += 1;
        if (pass > 1) deferred.push(file);
      } catch (err) {
        failed.push(file);
        lastError = (err as Error).message;
      }
    }

    if (appliedThisPass === 0) {
      throw new Error(
        `Migration apply stalled after pass ${pass}. ` +
          `${failed.length} migration(s) could not be applied:\n` +
          `${failed.join("\n")}\nLast error: ${lastError}`,
      );
    }
    pending = failed;
  }

  return { count: files.length, deferred };
}

async function seedOrg(
  pool: Pool,
  name: string,
  slug: string,
): Promise<SeededOrg> {
  // entitlement_level 'premium' clears requireEntitlement("standard") on
  // every customer-data route.
  const orgRes = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, status, entitlement_level)
     VALUES ($1, $2, 'active', 'premium')
     RETURNING id`,
    [name, slug],
  );
  const orgId = orgRes.rows[0].id;

  const rawKey = crypto.randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status)
     VALUES ($1, $2, $3, 'premium', 'active')`,
    [orgId, `harness-${slug}`, hashApiKey(rawKey)],
  );

  return { id: orgId, apiKey: rawKey };
}

/**
 * Seed one `findings` row for an org and return its id. Used by the RLS pilot
 * test (test/isolation/findingsRls.test.ts) to give the tenant-isolation policy
 * real rows to filter. Called as the owner/superuser connection (RLS bypassed),
 * so seeding is unaffected by the policy.
 *
 * `assessment_id` is nullable since 20260410 (findings can come from
 * non-assessment sources), so a finding needs no parent assessment — only the
 * NOT-NULL-without-default columns: organization_id, title, severity,
 * description. `source_type='manual'` satisfies the findings_source_type_check
 * constraint. The caller owns the pool.
 */
export async function seedFinding(pool: Pool, orgId: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type)
     VALUES ($1, $2, $3, $4, 'manual')
     RETURNING id`,
    [orgId, "Harness finding", "high", "seed finding for A04-G1 RLS pilot test"],
  );
  return res.rows[0].id;
}

/**
 * Drop, migrate and seed the test database. Returns the two seeded orgs.
 * The caller owns no pool — this opens and closes its own.
 */
export async function bootstrapTestDb(): Promise<TestDbSeed> {
  const pool = new Pool({
    connectionString: requireTestDatabaseUrl(),
    ssl: false,
  });

  try {
    await resetSchema(pool);
    const { count, deferred } = await applyMigrations(pool);
    // eslint-disable-next-line no-console
    console.log(`[harness] applied ${count} migrations to test database`);
    if (deferred.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[harness] ${deferred.length} migration(s) applied out of filename ` +
          `order (retry pass) — filename dates do not match dependency order:\n` +
          deferred.map((f) => `  - ${f}`).join("\n"),
      );
    }

    const suffix = Date.now();
    const orgA = await seedOrg(pool, "Harness Org A", `harness-a-${suffix}`);
    const orgB = await seedOrg(pool, "Harness Org B", `harness-b-${suffix}`);
    return { orgA, orgB };
  } finally {
    await pool.end();
  }
}
