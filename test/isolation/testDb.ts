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
 * Seed one `risks` row for an org and return its id. Used by the A04-G1 PR γ.1
 * risks tenant-wrap test (test/isolation/risksTenantWrap.test.ts). Seeded as the
 * owner connection (the `risks` table carries NO RLS policy yet — that is a
 * phase-3 Batch-A deliverable — so seeding is unaffected regardless).
 *
 * Only the NOT-NULL-without-default columns are required: organization_id,
 * title, domain, likelihood, impact, risk_rating. `status` defaults to 'open'.
 * residual_rating is set (= risk_rating) so the summary/intelligence aggregates
 * have a non-null residual bucket to count. Values satisfy the risk_*_check
 * constraints (likelihood ∈ very_likely…rare; impact/rating ∈ Critical…Low).
 * The caller owns the pool.
 */
export async function seedRisk(
  pool: Pool,
  orgId: string,
  opts: { rating?: string; title?: string } = {},
): Promise<string> {
  const rating = opts.rating ?? "High";
  const res = await pool.query<{ id: string }>(
    `INSERT INTO risks
       (organization_id, title, domain, likelihood, impact, risk_rating, residual_rating, status)
     VALUES ($1, $2, 'Vendor Risk', 'possible', 'High', $3, $3, 'open')
     RETURNING id`,
    [orgId, opts.title ?? "Harness risk", rating],
  );
  return res.rows[0].id;
}

/**
 * Seed one `posture_snapshots` row for an org and return its id. Used by the
 * A04-G1 Batch A.1 RLS enforcement test
 * (test/isolation/postureSnapshotsRls.test.ts). Seeded as the owner connection
 * (RLS bypassed for seeding) — the Batch A.1 migration enables RLS on
 * posture_snapshots, but the owner/superuser harness pool bypasses it, so
 * seeding is unaffected.
 *
 * Only the NOT-NULL-without-default columns are required: organization_id,
 * snapshot_date. `overall_score` is set (nullable, CHECK 0..100) for a
 * realistic row; the *_count columns default to 0 and computation_rationale to
 * '{}'. `snapshot_date` is parameterised (default '2026-01-01') because
 * posture_snapshots has UNIQUE (organization_id, snapshot_date) — a test that
 * INSERTs an additional row for the same org must pass a distinct date. The
 * caller owns the pool.
 */
export async function seedPostureSnapshot(
  pool: Pool,
  orgId: string,
  opts: { snapshotDate?: string; overallScore?: number } = {},
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO posture_snapshots (organization_id, snapshot_date, overall_score)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [orgId, opts.snapshotDate ?? "2026-01-01", opts.overallScore ?? 75],
  );
  return res.rows[0].id;
}

/**
 * Seed one `vendors` row for an org and return its id. Used by the A04-G1 PR γ.3
 * vendorAssessments tenant-wrap test (test/isolation/vendorAssessmentsTenantWrap
 * .test.ts). Seeded as the owner connection (`vendors` carries NO RLS policy yet
 * — phase-3 Batch A — so seeding is unaffected regardless).
 *
 * Only the NOT-NULL-without-default columns are required: organization_id, name.
 * `status` defaults to 'active' (the POST /vendor-assessments precheck requires
 * status='active' via SELECT … FOR UPDATE). `criticality` is set (defaults
 * 'high') so the background risk-score recompute produces a non-trivial score —
 * the value satisfies vendors_criticality_check (critical/high/medium/low). The
 * caller owns the pool.
 */
export async function seedVendor(
  pool: Pool,
  orgId: string,
  opts: { name?: string; criticality?: string } = {},
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name, status, criticality)
     VALUES ($1, $2, 'active', $3)
     RETURNING id`,
    [orgId, opts.name ?? `Harness vendor ${Date.now()}`, opts.criticality ?? "high"],
  );
  return res.rows[0].id;
}

/**
 * Seed one active `webhook_endpoints` row for an org and return its id. Used by
 * the A04-G1 PR β1 dispatcher test (test/isolation/webhookDispatcherElevated
 * .test.ts). The URL defaults to a loopback address so the dispatcher's SSRF
 * guard (assertSafeWebhookUrl) rejects it deterministically — exercising the
 * INSERT + scheduleRetry DB writes without any real network I/O. `event_types`
 * defaults to ['*'] so it matches any event. Seed as the owner (RLS irrelevant
 * — webhook tables carry no policy). The caller owns the pool.
 */
export async function seedWebhookEndpoint(
  pool: Pool,
  orgId: string,
  url = "http://127.0.0.1:9/webhook",
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO webhook_endpoints (organization_id, url, secret, status, event_types)
     VALUES ($1, $2, $3, 'active', ARRAY['*'])
     RETURNING id`,
    [orgId, url, "harness-webhook-secret"],
  );
  return res.rows[0].id;
}

/**
 * Seed one `users` row for an org and return its id + email. Used by the GDPR
 * export integration test (test/isolation/dataExport.test.ts). Only
 * organization_id + email are required (UNIQUE per (organization_id, email));
 * `name`/`password_hash` carry defaults. `withSecrets` populates the
 * credential columns the export MUST omit (password_hash, totp_secret) so the
 * test can assert they never reach the bundle. Seeded as the owner connection.
 * The caller owns the pool.
 */
export async function seedUser(
  pool: Pool,
  orgId: string,
  opts: { email?: string; name?: string; withSecrets?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? `user-${orgId.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}@example.com`;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, password_hash, totp_secret)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      orgId,
      email,
      opts.name ?? "Seed User",
      opts.withSecrets ? "SECRET_PASSWORD_HASH" : "",
      opts.withSecrets ? "SECRET_TOTP_SEED" : null,
    ],
  );
  return { id: res.rows[0].id, email };
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
