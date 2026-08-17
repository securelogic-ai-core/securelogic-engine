/**
 * m1-proof.ts — M-1 PR-3: the activation proof battery.
 * Design: docs/M1-app-request-flip-design.md §11.
 *
 * Proves BOTH sides of the privilege boundary using the ACTUAL identities:
 *
 *   RUNTIME  (M1_PROOF_RUNTIME_URL — the app_request DSN)
 *     A. is really the designed non-owner role (attributes asserted)
 *     B. FAILS every owner/DDL/role-level operation, with the SPECIFIC
 *        error class asserted (a probe failing for the wrong reason FAILS)
 *     C. is RLS-enforced: unscoped reads return only the GUC org, no GUC
 *        returns nothing, cross-org writes are refused        [needs seed]
 *     D. SUCCEEDS on legitimate tenant-scoped application DML  [needs seed]
 *
 *   MIGRATION (M1_PROOF_MIGRATION_URL — the owner DSN)
 *     E. still performs schema/migration operations (real DDL on a probe
 *        table; INSERT privilege on schema_migrations), sees across orgs
 *        (the elevated/admin path), and can run the worker claim shape.
 *
 * USAGE (harness or a per-environment activation run):
 *   M1_PROOF_RUNTIME_URL=postgres://app_request:...@host/db \
 *   M1_PROOF_MIGRATION_URL=postgres://<owner-login>:...@host/db \
 *   [M1_PROOF_SEED=true] [DATABASE_SSL_DISABLED=true] \
 *     npx tsx scripts/validation/m1-proof.ts
 *
 * M1_PROOF_SEED=true enables sections C/D: two probe orgs + one finding each
 * are created via the MIGRATION identity (names prefixed `m1-proof-`), used
 * for the RLS assertions, and deleted afterwards (best-effort; failures to
 * clean are reported loudly). Without the flag, C/D SKIP and the battery
 * covers identity + privilege boundaries only.
 *
 * Exit code 0 only if every non-skipped probe passes.
 */

import { Pool, type PoolClient } from "pg";

import { resolvePgSsl } from "../../src/api/infra/pgSsl.js";

const runtimeUrl = process.env.M1_PROOF_RUNTIME_URL;
const migrationUrl = process.env.M1_PROOF_MIGRATION_URL;
if (!runtimeUrl || !migrationUrl) {
  console.error("Set M1_PROOF_RUNTIME_URL (app_request DSN) and M1_PROOF_MIGRATION_URL (owner DSN).");
  process.exit(1);
}
const seedEnabled = process.env.M1_PROOF_SEED === "true";
const ssl = resolvePgSsl();

interface Result {
  section: string;
  probe: string;
  outcome: "PASS" | "FAIL" | "SKIP";
  detail?: string;
}
const results: Result[] = [];
function record(section: string, probe: string, outcome: Result["outcome"], detail?: string): void {
  results.push({ section, probe, outcome, detail });
  const mark = outcome === "PASS" ? "✓" : outcome === "SKIP" ? "–" : "✗";
  console.log(`${mark} [${section}] ${probe}${detail ? ` — ${detail}` : ""}`);
}

/** Run a statement expected to FAIL with one of the given SQLSTATEs. */
async function expectRefused(
  client: PoolClient,
  section: string,
  probe: string,
  sql: string,
  codes: string[]
): Promise<void> {
  try {
    await client.query(sql);
    record(section, probe, "FAIL", "statement UNEXPECTEDLY SUCCEEDED");
  } catch (err) {
    const code = (err as { code?: string }).code ?? "?";
    if (codes.includes(code)) record(section, probe, "PASS", `refused (${code})`);
    else record(section, probe, "FAIL", `refused with WRONG class ${code}: ${(err as Error).message}`);
  } finally {
    // failed statements abort the tx; reset the session
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function main(): Promise<void> {
  const runtime = new Pool({ connectionString: runtimeUrl, ssl, max: 2 });
  const migration = new Pool({ connectionString: migrationUrl, ssl, max: 2 });

  // ── A. runtime identity ──────────────────────────────────────────────────
  {
    const r = await runtime.query<{
      cu: string; su: string; bypass: boolean; createrole: boolean; superu: boolean; createdb: boolean;
    }>(`SELECT current_user AS cu, session_user AS su,
               rolbypassrls AS bypass, rolcreaterole AS createrole,
               rolsuper AS superu, rolcreatedb AS createdb
          FROM pg_roles WHERE rolname = current_user`);
    const row = r.rows[0];
    const ok = row.cu === "app_request" && row.su === "app_request" &&
      !row.bypass && !row.createrole && !row.superu && !row.createdb;
    record("A", "connected identity is app_request with restricted attributes",
      ok ? "PASS" : "FAIL", `current_user=${row.cu} bypassrls=${row.bypass} createrole=${row.createrole}`);

    const own = await runtime.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace
          AND pg_has_role(current_user, c.relowner, 'USAGE')`);
    record("A", "runtime identity owns no public relations",
      own.rows[0].n === "0" ? "PASS" : "FAIL", `owned=${own.rows[0].n}`);
  }

  // ── B. prohibited operations refuse ──────────────────────────────────────
  {
    const c = await runtime.connect();
    try {
      await expectRefused(c, "B", "CREATE TABLE (DDL)",
        "CREATE TABLE m1_proof_denied (id int)", ["42501"]);
      await expectRefused(c, "B", "DROP TABLE findings",
        "DROP TABLE findings", ["42501"]);
      await expectRefused(c, "B", "ALTER TABLE … DISABLE TRIGGER (the WORM bypass M-1 closes)",
        "ALTER TABLE security_audit_log DISABLE TRIGGER ALL", ["42501"]);
      await expectRefused(c, "B", "TRUNCATE findings",
        "TRUNCATE findings", ["42501"]);
      await expectRefused(c, "B", "CREATE ROLE (persistence/minting)",
        "CREATE ROLE m1_proof_role", ["42501"]);
      await expectRefused(c, "B", "ALTER ROLE erasure_agent LOGIN (erasure-credential minting)",
        "ALTER ROLE erasure_agent LOGIN", ["42501"]);
      await expectRefused(c, "B", "INSERT INTO schema_migrations (bookkeeping forgery)",
        "INSERT INTO schema_migrations (filename) VALUES ('m1-proof-forged.sql')", ["42501"]);
      await expectRefused(c, "B", "UPDATE audit_log (history rewrite; Tier B withholds UPDATE)",
        "UPDATE audit_log SET action = 'forged' WHERE false", ["42501"]);
      await expectRefused(c, "B", "DELETE FROM security_audit_log (history destruction)",
        "DELETE FROM security_audit_log WHERE false", ["42501"]);
      await expectRefused(c, "B", "SET ROLE erasure_agent (role assumption)",
        "SET ROLE erasure_agent", ["42501"]);
      await expectRefused(c, "B", "SELECT FROM worker_runs (Tier D — no grant)",
        "SELECT 1 FROM worker_runs LIMIT 1", ["42501"]);

      // GRANT by a non-owner without grant option does not error in Postgres —
      // it warns and grants nothing. Assert the outcome, not the exception.
      await c.query("GRANT SELECT ON findings TO erasure_agent").catch(() => {});
      await c.query("ROLLBACK").catch(() => {});
      const g = await runtime.query<{ has: boolean }>(
        `SELECT has_table_privilege('erasure_agent', 'findings', 'SELECT') AS has`);
      record("B", "GRANT attempt confers nothing (no grant option)",
        g.rows[0].has ? "FAIL" : "PASS");
    } finally {
      c.release();
    }
  }

  // ── seed for C/D ─────────────────────────────────────────────────────────
  let orgA: string | null = null;
  let orgB: string | null = null;
  let findingA: string | null = null;
  if (seedEnabled) {
    const suffix = process.pid.toString(36) + Math.trunc(process.uptime() * 1000).toString(36);
    const mk = async (tag: string): Promise<string> => {
      const r = await migration.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, status, entitlement_level)
         VALUES ($1, $2, 'active', 'premium') RETURNING id`,
        [`m1-proof-${tag}`, `m1-proof-${tag}-${suffix}`]);
      return r.rows[0].id;
    };
    orgA = await mk("a");
    orgB = await mk("b");
    const f = await migration.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, description, source_type)
       VALUES ($1, 'm1-proof finding A', 'high', 'M-1 proof battery probe row', 'manual')
       RETURNING id`, [orgA]);
    findingA = f.rows[0].id;
    await migration.query(
      `INSERT INTO findings (organization_id, title, severity, description, source_type)
       VALUES ($1, 'm1-proof finding B', 'high', 'M-1 proof battery probe row', 'manual')`, [orgB]);
  }

  // ── C. RLS enforcement for the runtime identity ──────────────────────────
  if (!seedEnabled) {
    record("C", "RLS enforcement (unscoped read / no-GUC / cross-org write)", "SKIP", "M1_PROOF_SEED not set");
  } else {
    const c = await runtime.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_org_id', $1, true)", [orgA]);
      const scoped = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM findings WHERE title LIKE 'm1-proof finding %'`);
      const onlyA = scoped.rows.length === 1 && scoped.rows[0].organization_id === orgA;
      record("C", "unscoped SELECT returns ONLY the GUC org's rows", onlyA ? "PASS" : "FAIL",
        `rows=${scoped.rows.length}`);
      const crossUpd = await c.query(
        `UPDATE findings SET description = 'forged' WHERE organization_id = $1`, [orgB]);
      record("C", "cross-org UPDATE affects zero rows", (crossUpd.rowCount ?? 0) === 0 ? "PASS" : "FAIL");
      const crossDel = await c.query(
        `DELETE FROM findings WHERE organization_id = $1`, [orgB]);
      record("C", "cross-org DELETE affects zero rows", (crossDel.rowCount ?? 0) === 0 ? "PASS" : "FAIL");
      await c.query("ROLLBACK");

      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_org_id', $1, true)", [orgA]);
        await c.query(
          `INSERT INTO findings (organization_id, title, severity, description, source_type)
           VALUES ($1, 'm1-proof forged', 'high', 'x', 'manual')`, [orgB]);
        record("C", "cross-org INSERT refused by policy", "FAIL", "insert unexpectedly succeeded");
      } catch (err) {
        const code = (err as { code?: string }).code;
        record("C", "cross-org INSERT refused by policy", code === "42501" ? "PASS" : "FAIL",
          `code=${code}`);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }

      const noGuc = await c.query(`SELECT 1 FROM findings WHERE title LIKE 'm1-proof finding %'`);
      record("C", "no tenant GUC ⇒ zero rows (fail-closed)", noGuc.rows.length === 0 ? "PASS" : "FAIL",
        `rows=${noGuc.rows.length}`);
    } finally {
      c.release();
    }
  }

  // ── D. legitimate runtime operations succeed ─────────────────────────────
  if (!seedEnabled) {
    record("D", "tenant-scoped application DML", "SKIP", "M1_PROOF_SEED not set");
  } else {
    const c = await runtime.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_org_id', $1, true)", [orgA]);
      const upd = await c.query(
        `UPDATE findings SET description = 'm1-proof updated' WHERE id = $1 AND organization_id = $2`,
        [findingA, orgA]);
      record("D", "own-org UPDATE succeeds", (upd.rowCount ?? 0) === 1 ? "PASS" : "FAIL");
      const ins = await c.query<{ id: string }>(
        `INSERT INTO findings (organization_id, title, severity, description, source_type)
         VALUES ($1, 'm1-proof inserted', 'medium', 'probe', 'manual') RETURNING id`, [orgA]);
      record("D", "own-org INSERT succeeds", ins.rows.length === 1 ? "PASS" : "FAIL");
      const del = await c.query(`DELETE FROM findings WHERE id = $1 AND organization_id = $2`,
        [ins.rows[0]?.id, orgA]);
      record("D", "own-org DELETE succeeds", (del.rowCount ?? 0) === 1 ? "PASS" : "FAIL");
      const orgRead = await c.query(`SELECT entitlement_level FROM organizations WHERE id = $1`, [orgA]);
      record("D", "organizations read (auth path, Tier C SELECT)", orgRead.rows.length === 1 ? "PASS" : "FAIL");
      const audit = await c.query(
        `INSERT INTO audit_log (organization_id, actor_type, action, route)
         VALUES ($1, 'system', 'm1.proof', '/m1-proof') RETURNING id`, [orgA]);
      record("D", "audit_log INSERT succeeds (Tier B append)", audit.rows.length === 1 ? "PASS" : "FAIL");
      await c.query("ROLLBACK"); // discard all D-section writes
    } catch (err) {
      record("D", "tenant-scoped application DML", "FAIL", (err as Error).message);
      await c.query("ROLLBACK").catch(() => {});
    } finally {
      c.release();
    }
  }

  // ── E. migration identity ────────────────────────────────────────────────
  {
    const c = await migration.connect();
    try {
      await c.query("BEGIN");
      await c.query("CREATE TABLE m1_proof_ddl (id int)");
      await c.query("ALTER TABLE m1_proof_ddl ADD COLUMN note text");
      await c.query("DROP TABLE m1_proof_ddl");
      await c.query("ROLLBACK");
      record("E", "DDL (CREATE/ALTER/DROP) succeeds on the migration identity", "PASS");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      record("E", "DDL (CREATE/ALTER/DROP) succeeds on the migration identity", "FAIL", (err as Error).message);
    } finally {
      c.release();
    }
    const mig = await migration.query<{ has: boolean }>(
      `SELECT has_table_privilege(current_user, 'schema_migrations', 'INSERT') AS has`);
    record("E", "schema_migrations INSERT privilege (migration bookkeeping)",
      mig.rows[0].has ? "PASS" : "FAIL");
    if (seedEnabled) {
      const all = await migration.query<{ n: string }>(
        `SELECT count(DISTINCT organization_id)::text AS n
           FROM findings WHERE title LIKE 'm1-proof finding %'`);
      record("E", "elevated cross-org read sees BOTH probe orgs (admin/worker path)",
        all.rows[0].n === "2" ? "PASS" : "FAIL", `orgs=${all.rows[0].n}`);
      const claim = await migration.query(
        `SELECT id FROM jobs WHERE status = 'queued' AND organization_id IS NOT NULL LIMIT 1`);
      record("E", "worker claim-poll SHAPE runs on the elevated channel",
        "PASS", `visible queued jobs sample=${claim.rows.length}`);
    } else {
      record("E", "elevated cross-org read", "SKIP", "M1_PROOF_SEED not set");
    }
  }

  // ── cleanup ──────────────────────────────────────────────────────────────
  if (seedEnabled) {
    try {
      await migration.query(`DELETE FROM findings WHERE title LIKE 'm1-proof %'`);
      await migration.query(`DELETE FROM organizations WHERE name IN ('m1-proof-a','m1-proof-b')`);
      record("cleanup", "probe orgs + findings removed", "PASS");
    } catch (err) {
      record("cleanup", "probe rows removed", "FAIL",
        `LEFTOVER PROBE DATA (name prefix m1-proof-): ${(err as Error).message}`);
    }
  }

  await runtime.end();
  await migration.end();

  const fails = results.filter(r => r.outcome === "FAIL");
  const skips = results.filter(r => r.outcome === "SKIP");
  console.log(`\nM1 PROOF: ${fails.length === 0 ? "PASS" : "FAIL"} — ` +
    `${results.filter(r => r.outcome === "PASS").length} passed, ${fails.length} failed, ${skips.length} skipped`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("m1-proof crashed:", err);
  process.exit(1);
});
