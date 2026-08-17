/**
 * erasure-authorization-rollback-rehearsal.ts — E-2 Increment 2 rollback proof.
 *
 * Proves, on a fresh database: the increment applies; the guard's exception is
 * present; the rollback REFUSES while a certificate exists (protecting the
 * 7-year evidence); and once no certificate exists it restores the
 * unconditional guard, removes the role, and leaves erasure impossible again.
 */
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import {
  applyMigration, ensureMigrationTable, listMigrationFilenames,
  DEFAULT_LOCK_TIMEOUT, DEFAULT_STATEMENT_TIMEOUT,
} from "../../src/api/lib/migrationRunner.js";

const T = { lockTimeout: DEFAULT_LOCK_TIMEOUT, statementTimeout: DEFAULT_STATEMENT_TIMEOUT };
const pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
let failures = 0;
const check = (cond: boolean, label: string, detail = "") => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

async function run(file: string): Promise<{ ok: boolean; error?: string }> {
  const c = await pool.connect();
  try {
    await c.query(fs.readFileSync(file, "utf8"));
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, error: (e as Error).message };
  } finally {
    c.release();
  }
}

(async () => {
  console.log("E-2 Increment 2 rollback rehearsal\n");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await ensureMigrationTable(pool, T);
  const dir = path.resolve("db/migrations");
  const files = listMigrationFilenames(dir);
  const c = await pool.connect();
  for (const f of files) await applyMigration(c, f, fs.readFileSync(path.join(dir, f), "utf8"), T);
  c.release();
  console.log(`1. FORWARD\n  PASS  applied ${files.length} migrations in strict order`);

  const roleExists = async () =>
    (await pool.query(`SELECT 1 FROM pg_roles WHERE rolname='erasure_agent'`)).rowCount === 1;
  const guardHasException = async () =>
    (await pool.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE proname='worm_guard_mutation'`)).rows[0]!.src.includes("erasure_agent");

  check(await roleExists(), "erasure_agent role created");
  check(await guardHasException(), "guard carries the certified-erasure exception");

  console.log("\n2. REFUSAL — a certificate must not be destroyed by a rollback");
  const org = (await pool.query<{ id: string }>(
    `INSERT INTO organizations (name,slug) VALUES ('rb','rb-'||floor(random()*1e12)::text) RETURNING id`)).rows[0]!.id;
  await pool.query(
    `INSERT INTO erasure_certificates (organization_id, requested_by_user_id, approved_by_user_id,
       reason, legal_basis, dry_run, status, approved_at)
     VALUES ($1, gen_random_uuid(), gen_random_uuid(), 'rehearsal', 'gdpr_art17_request', true, 'approved', now())`,
    [org]);
  const refused = await run("db/rollback/20261018_erasure_authorization_rollback.sql");
  check(!refused.ok, "the rollback REFUSED", refused.error?.split("\n")[0]?.slice(0, 90));
  check((refused.error ?? "").includes("7-year retention"), "it refused for the right reason");
  check((await pool.query(`SELECT 1 FROM erasure_certificates`)).rowCount === 1,
    "the certificate was PRESERVED, not deleted");

  console.log("\n3. CLEAN PATH");
  // Removing the certificate is itself only possible as a deliberate act by the
  // owner disabling the guard — which is exactly the point being made.
  await pool.query(`ALTER TABLE erasure_certificates DISABLE TRIGGER prevent_erasure_certificates_delete`);
  await pool.query(`DELETE FROM erasure_certificates`);
  await pool.query(`ALTER TABLE erasure_certificates ENABLE TRIGGER prevent_erasure_certificates_delete`);
  const clean = await run("db/rollback/20261018_erasure_authorization_rollback.sql");
  check(clean.ok, "the rollback COMMITTED", clean.error ?? "");
  check(!(await roleExists()), "erasure_agent removed");
  check(!(await guardHasException()), "guard restored to its unconditional form");
  check((await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='erasure_certificates'`)).rowCount === 0,
    "erasure_certificates dropped");
  check((await pool.query(
    `SELECT 1 FROM schema_migrations WHERE filename='20261018_erasure_authorization.sql'`)).rowCount === 0,
    "20261018 unstamped");

  console.log("\n4. ERASURE IS IMPOSSIBLE AGAIN");
  const org2 = (await pool.query<{ id: string }>(
    `INSERT INTO organizations (name,slug) VALUES ('rb2','rb2-'||floor(random()*1e12)::text) RETURNING id`)).rows[0]!.id;
  await pool.query(
    `INSERT INTO security_audit_log (organization_id,event_type,resource_type) VALUES ($1,'p','p')`, [org2]);
  const c2 = await pool.connect();
  try {
    await c2.query("BEGIN");
    await c2.query(`DELETE FROM organizations WHERE id=$1`, [org2]);
    check(false, "org deletion should have raised");
  } catch (e) {
    check(/append-only/.test((e as Error).message), "org deletion raises, as before Increment 2",
      (e as Error).message.slice(0, 60));
  } finally {
    await c2.query("ROLLBACK").catch(() => {});
    c2.release();
  }

  console.log(`\n${failures === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED — ${failures} check(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})();
