/**
 * e2-full-rollback-chain-rehearsal.ts — proves the THREE E-2 rollbacks compose,
 * in the only order that works, from a fresh database.
 *
 * Increment 3 -> Increment 2 -> Increment 1. Each refuses loudly if run out of
 * order, so a mis-sequenced rollback fails safe rather than half-dismantling a
 * control.
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
let fail = 0;
const check = (c: boolean, l: string, d = "") => { if (!c) fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`); };

const R3 = "db/rollback/20261019_20261020_erasure_execution_rollback.sql";
const R2 = "db/rollback/20261018_erasure_authorization_rollback.sql";
const R1 = "db/rollback/20261017_worm_guard_consolidation_rollback.sql";

async function run(file: string) {
  const c = await pool.connect();
  try { await c.query(fs.readFileSync(file, "utf8")); return { ok: true as const }; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); return { ok: false as const, error: (e as Error).message }; }
  finally { c.release(); }
}

(async () => {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("DROP ROLE IF EXISTS erasure_agent").catch(() => {});
  await ensureMigrationTable(pool, T);
  const dir = path.resolve("db/migrations");
  const files = listMigrationFilenames(dir);
  const c = await pool.connect();
  for (const f of files) await applyMigration(c, f, fs.readFileSync(path.join(dir, f), "utf8"), T);
  c.release();
  console.log(`applied ${files.length} migrations\n`);

  console.log("WRONG ORDER — Increment 1 first");
  const w1 = await run(R1);
  check(!w1.ok, "refused", w1.error?.split("\n")[0]?.slice(0, 70));

  console.log("\nWRONG ORDER — Increment 2 before Increment 3");
  const w2 = await run(R2);
  check(!w2.ok, "refused", w2.error?.split("\n")[0]?.slice(0, 70));

  console.log("\nRIGHT ORDER — 3, then 2, then 1");
  const a = await run(R3); check(a.ok, "Increment 3 rollback committed", a.error ?? "");
  const b = await run(R2); check(b.ok, "Increment 2 rollback committed", b.error ?? "");
  const d = await run(R1); check(d.ok, "Increment 1 rollback committed", d.error ?? "");

  const fns = (await pool.query<{ proname: string }>(
    `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (proname LIKE 'erasure%' OR proname='worm_guard_mutation') ORDER BY 1`)).rows.map(r => r.proname);
  check(fns.length === 0, "every erasure function removed", fns.join(", ") || "none");
  check((await pool.query(`SELECT 1 FROM pg_roles WHERE rolname='erasure_agent'`)).rowCount === 0, "role removed");
  check((await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='erasure_certificates'`)).rowCount === 0,
    "erasure_certificates dropped");

  // And the pre-E-2 protection is back.
  const org = (await pool.query<{ id: string }>(
    `INSERT INTO organizations (name,slug) VALUES ('rb','rb-'||floor(random()*1e12)::text) RETURNING id`)).rows[0]!.id;
  await pool.query(`INSERT INTO security_audit_log (organization_id,event_type,resource_type) VALUES ($1,'p','p')`, [org]);
  const cc = await pool.connect();
  try {
    await cc.query("BEGIN");
    await cc.query(`DELETE FROM organizations WHERE id=$1`, [org]);
    check(false, "org deletion should have raised");
  } catch (e) {
    check(/append-only/.test((e as Error).message), "erasure impossible again, as before E-2");
  } finally { await cc.query("ROLLBACK").catch(() => {}); cc.release(); }

  console.log(`\n${fail === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED — ${fail}`}`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})();
