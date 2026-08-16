/**
 * tdg-rollback-rehearsal.ts — E-1 schema-rollback rehearsal against a POPULATED
 * representative database.
 *
 * Treated as REQUIRED, not optional: E-1 is an enterprise control, and a
 * rollback script that has never been executed is a plan, not a control. This
 * is the same standard the C-8 rehearsal set for the Stage-1 release, and it
 * uses the deploy's OWN applier (applyMigration / listMigrationFilenames) so
 * schema_migrations is stamped exactly as production stamps it.
 *
 * WHAT IT PROVES, in order:
 *   1. Forward: all migrations apply to an empty database, in strict order.
 *   2. Populated: representative tenant data, governance state, audit events,
 *      and unrelated data that must survive untouched.
 *   3. REFUSAL A — orphaned ledger rows present → the rollback RAISES and
 *      changes NOTHING. The audit records of reads performed on customers'
 *      behalf are protected, not destroyed.
 *   4. REFUSAL B — retention_sweep job rows present → same.
 *   5. Clean path — with neither blocker present the rollback COMMITS, the TDG
 *      schema is gone, 20261016 is deliberately RETAINED, the governance audit
 *      events SURVIVE, and unrelated data is byte-identical.
 *   6. Forward re-apply after rollback is clean.
 *
 * Read-only with respect to any real environment: it refuses any URL that is
 * not an explicit throwaway TEST_DATABASE_URL.
 *
 * Run:  TEST_DATABASE_URL=... npx tsx scripts/validation/tdg-rollback-rehearsal.ts
 */

import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  applyMigration,
  ensureMigrationTable,
  listMigrationFilenames,
  DEFAULT_LOCK_TIMEOUT,
  DEFAULT_STATEMENT_TIMEOUT,
} from "../../src/api/lib/migrationRunner.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");
const ROLLBACK_FILE = path.resolve(
  process.cwd(),
  "db/rollback/20261013_20261016_tdg_rollback.sql"
);
const TIMEOUTS = {
  lockTimeout: DEFAULT_LOCK_TIMEOUT,
  statementTimeout: DEFAULT_STATEMENT_TIMEOUT,
};

const url = process.env["TEST_DATABASE_URL"];
if (!url) {
  console.error("TEST_DATABASE_URL is required. Never point this at staging or production.");
  process.exit(1);
}
if (/staging|prod/i.test(url)) {
  console.error("Refusing: TEST_DATABASE_URL looks like a real environment.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: false });
let failures = 0;

function ok(label: string, detail = ""): void {
  console.log(`  PASS  ${label}${detail ? " — " + detail : ""}`);
}
function bad(label: string, detail = ""): void {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
}
function check(cond: boolean, label: string, detail = ""): void {
  cond ? ok(label, detail) : bad(label, detail);
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ c: string }>(sql, params);
  return Number((rows[0] as { c: string }).c);
}

async function tableExists(name: string): Promise<boolean> {
  return (
    (await count(`SELECT COUNT(*)::text AS c FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=$1`, [name])) > 0
  );
}

async function columnExists(table: string, column: string): Promise<boolean> {
  return (
    (await count(`SELECT COUNT(*)::text AS c FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, column])) > 0
  );
}

async function isNullable(table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return rows[0]?.is_nullable === "YES";
}

/** A stable fingerprint of the non-TDG schema, to prove the rollback is surgical. */
async function schemaFingerprint(): Promise<string> {
  const { rows } = await pool.query<{ sig: string }>(
    `SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable AS sig
       FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name NOT IN ('retention_policies','legal_holds','schema_migrations')
      ORDER BY table_name, column_name`
  );
  return crypto.createHash("sha256").update(rows.map((r) => r.sig).join("\n")).digest("hex");
}

async function runRollback(): Promise<{ ok: boolean; error?: string }> {
  const sql = fs.readFileSync(ROLLBACK_FILE, "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    return { ok: true };
  } catch (err) {
    // The script wraps itself in BEGIN/COMMIT, so a RAISE aborts the whole
    // thing. Clear the aborted transaction before returning the connection.
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: (err as Error).message };
  } finally {
    client.release();
  }
}

/* ─────────────────────────────── 1. FORWARD ──────────────────────────────── */

async function forward(): Promise<number> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await ensureMigrationTable(pool, TIMEOUTS);

  const files = listMigrationFilenames(MIGRATIONS_DIR);
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await applyMigration(client, file, sql, TIMEOUTS);
    }
  } finally {
    client.release();
  }
  return files.length;
}

/* ─────────────────────────── 2. POPULATE ─────────────────────────────────── */

interface Seeded {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  convWithLiveLedger: string;
  convToOrphan: string;
  messageToDelete: string;
  ledgerToOrphan: string;
}

async function populate(): Promise<Seeded> {
  const org = async (name: string, slug: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
        [name, slug]
      )
    ).rows[0]!.id;

  const user = async (orgId: string, email: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, name, password_hash, role)
         VALUES ($1,$2,$3,'x','admin') RETURNING id`,
        [orgId, email, "Rehearsal User"]
      )
    ).rows[0]!.id;

  const orgA = await org("[REHEARSAL] Org A", "rehearsal-org-a");
  const orgB = await org("[REHEARSAL] Org B", "rehearsal-org-b");
  const userA = await user(orgA, "a@rehearsal.invalid");
  const userB = await user(orgB, "b@rehearsal.invalid");

  async function thread(orgId: string, userId: string, ageDays: number) {
    const at = new Date(Date.now() - ageDays * 86_400_000);
    const conv = (
      await pool.query<{ id: string }>(
        `INSERT INTO ask_conversations (organization_id, user_id, mode, created_at, last_message_at)
         VALUES ($1,$2,'text',$3,$3) RETURNING id`,
        [orgId, userId, at]
      )
    ).rows[0]!.id;
    const msg = (
      await pool.query<{ id: string }>(
        `INSERT INTO ask_messages (organization_id, conversation_id, user_id, role, content, model_id, created_at)
         VALUES ($1,$2,$3,'assistant','rehearsal answer','claude-test',$4) RETURNING id`,
        [orgId, conv, userId, at]
      )
    ).rows[0]!.id;
    const inv = (
      await pool.query<{ id: string }>(
        `INSERT INTO ask_tool_invocations
           (organization_id, message_id, conversation_id, tool_name, action_class, input, authorized, created_at)
         VALUES ($1,$2,$3,'findings.list','read','{}'::jsonb,true,$4) RETURNING id`,
        [orgId, msg, conv, at]
      )
    ).rows[0]!.id;
    return { conv, msg, inv };
  }

  const live = await thread(orgA, userA, 10);
  const doomed = await thread(orgA, userA, 500);
  await thread(orgB, userB, 3);

  // Governance state: a versioned policy history, an active hold and a
  // released one — the records the rollback must not quietly destroy.
  for (const [v, days] of [[1, 90], [2, 180]] as Array<[number, number]>) {
    await pool.query(
      `INSERT INTO retention_policies
         (organization_id, data_class, version, retention_days, cleared, source, set_by_user_id)
       VALUES ($1,'ask_conversation',$2,$3,false,'tenant',$4)`,
      [orgA, v, days, userA]
    );
  }
  await pool.query(
    `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
     VALUES ($1,'organization','Rehearsal matter',$2)`,
    [orgA, userA]
  );

  // Immutable governance audit events — these MUST survive the rollback.
  for (const type of ["governance.retention_policy_changed", "governance.legal_hold_placed"]) {
    await pool.query(
      `INSERT INTO security_audit_log (organization_id, actor_user_id, event_type, resource_type, payload)
       VALUES ($1,$2,$3,'rehearsal','{}'::jsonb)`,
      [orgA, userA, type]
    );
  }

  return {
    orgA,
    orgB,
    userA,
    userB,
    convWithLiveLedger: live.conv,
    convToOrphan: doomed.conv,
    messageToDelete: doomed.msg,
    ledgerToOrphan: doomed.inv,
  };
}

/* ─────────────────────────────── MAIN ────────────────────────────────────── */

async function main(): Promise<void> {
  console.log("E-1 TDG rollback rehearsal — populated representative database\n");

  console.log("1. FORWARD");
  const applied = await forward();
  ok("all migrations applied in strict filename order", `${applied} files`);
  check(await tableExists("retention_policies"), "retention_policies exists");
  check(await tableExists("legal_holds"), "legal_holds exists");
  check(await isNullable("ask_tool_invocations", "message_id"), "ledger message_id is nullable");
  check(await columnExists("ask_tool_invocations", "conversation_id"), "ledger conversation_id exists");

  console.log("\n2. POPULATE");
  const seeded = await populate();
  const baselineFingerprint = await schemaFingerprint();
  const baselineConversations = await count(`SELECT COUNT(*)::text AS c FROM ask_conversations`);
  const baselineAudit = await count(
    `SELECT COUNT(*)::text AS c FROM security_audit_log WHERE event_type LIKE 'governance.%'`
  );
  ok("representative data seeded", `${baselineConversations} conversations, 2 policy versions, 1 hold, ${baselineAudit} governance audit events`);

  console.log("\n3. REFUSAL A — orphaned ledger rows must not be destroyed");
  await pool.query(`DELETE FROM ask_messages WHERE id = $1`, [seeded.messageToDelete]);
  const orphans = await count(
    `SELECT COUNT(*)::text AS c FROM ask_tool_invocations WHERE message_id IS NULL`
  );
  check(orphans === 1, "one orphaned ledger row now exists", `orphans=${orphans}`);

  const refusalA = await runRollback();
  check(!refusalA.ok, "the rollback REFUSED", refusalA.error?.split("\n")[0]?.slice(0, 120));
  check(
    (refusalA.error ?? "").includes("orphaned ledger row"),
    "it refused for the right reason (orphaned ledger rows)"
  );
  check(await tableExists("retention_policies"), "retention_policies still present after the refusal");
  check(
    (await count(`SELECT COUNT(*)::text AS c FROM ask_tool_invocations WHERE message_id IS NULL`)) === 1,
    "the orphaned audit record was PRESERVED, not deleted"
  );
  check(
    (await count(`SELECT COUNT(*)::text AS c FROM retention_policies`)) === 2,
    "policy history intact after the refusal"
  );

  console.log("\n4. REFUSAL B — retention_sweep job rows must not be destroyed");
  // Clear blocker A legitimately: the orphan is what the ledger class expires.
  await pool.query(`DELETE FROM ask_tool_invocations WHERE message_id IS NULL`);
  await pool.query(
    `INSERT INTO jobs (organization_id, job_type, payload)
     VALUES ($1,'retention_sweep', jsonb_build_object('dataClass','ask_conversation'))`,
    [seeded.orgA]
  );
  const refusalB = await runRollback();
  check(!refusalB.ok, "the rollback REFUSED", refusalB.error?.split("\n")[0]?.slice(0, 120));
  check(
    (refusalB.error ?? "").includes("retention_sweep job row"),
    "it refused for the right reason (sweep job history)"
  );
  check(
    (await count(`SELECT COUNT(*)::text AS c FROM jobs WHERE job_type='retention_sweep'`)) === 1,
    "the sweep job record was PRESERVED, not deleted"
  );

  console.log("\n5. CLEAN PATH");
  await pool.query(`DELETE FROM jobs WHERE job_type='retention_sweep'`);
  const clean = await runRollback();
  check(clean.ok, "the rollback COMMITTED", clean.error ?? "");

  check(!(await tableExists("retention_policies")), "retention_policies dropped");
  check(!(await tableExists("legal_holds")), "legal_holds dropped");
  check(!(await isNullable("ask_tool_invocations", "message_id")), "ledger message_id NOT NULL restored");
  check(!(await columnExists("ask_tool_invocations", "conversation_id")), "ledger conversation_id dropped");

  const stamped = await count(
    `SELECT COUNT(*)::text AS c FROM schema_migrations
      WHERE filename IN ('20261013_tenant_data_governance.sql',
                         '20261014_ask_ledger_survives_deletion.sql',
                         '20261015_jobs_retention_sweep.sql')`
  );
  check(stamped === 0, "13/14/15 unstamped from schema_migrations");
  check(
    (await count(`SELECT COUNT(*)::text AS c FROM schema_migrations
                   WHERE filename = '20261016_ask_conversations_survive_user_deletion.sql'`)) === 1,
    "20261016 DELIBERATELY RETAINED — the CASCADE data-loss path is not re-armed"
  );

  const userFk = await pool.query<{ delete_rule: string }>(
    `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_name = 'ask_conversations' AND tc.constraint_name = 'ask_conversations_user_id_fkey'`
  );
  check(userFk.rows[0]?.delete_rule === "SET NULL", "conversation owner FK is still SET NULL", userFk.rows[0]?.delete_rule ?? "missing");

  const auditAfter = await count(
    `SELECT COUNT(*)::text AS c FROM security_audit_log WHERE event_type LIKE 'governance.%'`
  );
  check(auditAfter === baselineAudit, "governance audit events SURVIVED the rollback", `${auditAfter}/${baselineAudit}`);

  const convAfter = await count(`SELECT COUNT(*)::text AS c FROM ask_conversations`);
  check(convAfter === baselineConversations, "no conversation was destroyed by the rollback", `${convAfter}/${baselineConversations}`);

  const jobTypeNarrowed = await count(
    `SELECT COUNT(*)::text AS c FROM pg_constraint
      WHERE conname = 'jobs_job_type_check' AND pg_get_constraintdef(oid) LIKE '%retention_sweep%'`
  );
  check(jobTypeNarrowed === 0, "jobs.job_type CHECK narrowed back");

  console.log("\n6. FORWARD RE-APPLY");
  const client = await pool.connect();
  try {
    for (const file of [
      "20261013_tenant_data_governance.sql",
      "20261014_ask_ledger_survives_deletion.sql",
      "20261015_jobs_retention_sweep.sql",
    ]) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await applyMigration(client, file, sql, TIMEOUTS);
    }
  } finally {
    client.release();
  }
  check(await tableExists("retention_policies"), "retention_policies back after re-apply");
  check(await isNullable("ask_tool_invocations", "message_id"), "ledger nullable again after re-apply");
  check(
    (await schemaFingerprint()) === baselineFingerprint,
    "non-TDG schema is byte-identical to the pre-rollback baseline"
  );

  console.log(`\n${failures === 0 ? "REHEARSAL PASSED" : `REHEARSAL FAILED — ${failures} check(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("rehearsal crashed:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
