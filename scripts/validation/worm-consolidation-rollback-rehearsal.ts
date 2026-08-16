import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import {
  applyMigration, ensureMigrationTable, listMigrationFilenames,
  DEFAULT_LOCK_TIMEOUT, DEFAULT_STATEMENT_TIMEOUT,
} from "../../src/api/lib/migrationRunner.js";

const T = { lockTimeout: DEFAULT_LOCK_TIMEOUT, statementTimeout: DEFAULT_STATEMENT_TIMEOUT };
const pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });

(async () => {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await ensureMigrationTable(pool, T);
  const dir = path.resolve("db/migrations");
  const files = listMigrationFilenames(dir);
  const c = await pool.connect();
  for (const f of files) await applyMigration(c, f, fs.readFileSync(path.join(dir, f), "utf8"), T);
  c.release();
  console.log("applied", files.length, "migrations");

  const g = async () =>
    (await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE NOT t.tgisinternal AND p.proname='worm_guard_mutation'`)).rows[0]!.n;
  console.log("triggers on shared guard BEFORE:", await g());

  const c2 = await pool.connect();
  try {
    await c2.query(fs.readFileSync("db/rollback/20261017_worm_guard_consolidation_rollback.sql", "utf8"));
    console.log("ROLLBACK: COMMITTED");
  } catch (e) {
    console.log("ROLLBACK FAILED:", String((e as Error).message).slice(0, 140));
    await c2.query("ROLLBACK").catch(() => {});
  }
  c2.release();
  console.log("triggers on shared guard AFTER:", await g());

  const fns = (await pool.query<{ proname: string }>(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.prosrc ILIKE '%not permitted%' OR p.prosrc ILIKE '%is forbidden%'
            OR p.proname='worm_guard_mutation') ORDER BY 1`)).rows.map(r => r.proname);
  console.log("functions:", fns.join(", "));

  const org = (await pool.query<{ id: string }>(
    `INSERT INTO organizations (name,slug) VALUES ('rb','rb-org') RETURNING id`)).rows[0]!.id;
  const id = (await pool.query<{ id: string }>(
    `INSERT INTO security_audit_log (organization_id,event_type,resource_type) VALUES ($1,'p','p') RETURNING id`,
    [org])).rows[0]!.id;
  try {
    await pool.query(`DELETE FROM security_audit_log WHERE id=$1`, [id]);
    console.log("post-rollback DELETE -> SUCCEEDED (BAD)");
  } catch (e) {
    console.log("post-rollback DELETE ->", (e as Error).message);
  }
  const stamped = (await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM schema_migrations WHERE filename='20261017_worm_guard_consolidation.sql'`)).rows[0]!.n;
  console.log("20261017 still stamped:", stamped);
  await pool.end();
})();
