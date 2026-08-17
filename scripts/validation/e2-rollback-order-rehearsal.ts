/**
 * e2-rollback-order-rehearsal.ts — proves the two E-2 rollbacks compose, in the
 * only order that works, from a fresh database.
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
const check = (c: boolean, l: string, d = "") => { if (!c) failures++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`); };

async function run(file: string) {
  const c = await pool.connect();
  try { await c.query(fs.readFileSync(file, "utf8")); return { ok: true as const }; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); return { ok: false as const, error: (e as Error).message }; }
  finally { c.release(); }
}

(async () => {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await ensureMigrationTable(pool, T);
  const dir = path.resolve("db/migrations");
  const files = listMigrationFilenames(dir);
  const c = await pool.connect();
  for (const f of files) await applyMigration(c, f, fs.readFileSync(path.join(dir, f), "utf8"), T);
  c.release();
  console.log(`applied ${files.length} migrations\n`);

  console.log("WRONG ORDER — Increment 1 first, while Increment 2 is layered on it");
  const wrong = await run("db/rollback/20261017_worm_guard_consolidation_rollback.sql");
  check(!wrong.ok, "refused", wrong.error?.split("\n")[0]?.slice(0, 80));
  check((wrong.error ?? "").includes("still reference it"), "refused for the ordering reason");

  console.log("\nRIGHT ORDER — Increment 2, then Increment 1");
  const a = await run("db/rollback/20261018_erasure_authorization_rollback.sql");
  check(a.ok, "Increment 2 rollback committed", a.error ?? "");
  const b = await run("db/rollback/20261017_worm_guard_consolidation_rollback.sql");
  check(b.ok, "Increment 1 rollback committed", b.error ?? "");

  const fns = (await pool.query<{ proname: string }>(
    `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.prosrc ILIKE '%not permitted%' OR p.prosrc ILIKE '%is forbidden%'
            OR p.proname='worm_guard_mutation') ORDER BY 1`)).rows.map(r => r.proname);
  check(!fns.includes("worm_guard_mutation"), "shared guard removed");
  check(fns.length === 7, "the six per-table functions plus legal_holds' state machine are back", fns.join(", "));
  check((await pool.query(`SELECT 1 FROM pg_roles WHERE rolname='erasure_agent'`)).rowCount === 0, "role removed");

  console.log(`\n${failures === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED — ${failures}`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})();
