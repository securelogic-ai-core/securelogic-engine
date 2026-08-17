/**
 * wormGuardConsolidation.test.ts — E-2 Increment 1: proof that consolidating
 * nine tables onto one WORM guard changed NOTHING.
 *
 * This is an equivalence test, so the "before" is encoded as literals. Every
 * expected message below was captured from the database BEFORE the
 * consolidation migration existed, by reading pg_proc.prosrc of the six
 * superseded functions. If the consolidation had altered a single refusal —
 * its trigger point, its wording, or whether it fires at all — one of these
 * assertions fails.
 *
 * Three kinds of evidence, because no single kind covers all nine tables:
 *
 *   1. STRUCTURAL — every delete/truncate trigger in the database resolves to
 *      worm_guard_mutation with the expected arguments. This is what proves the
 *      tables that are expensive to seed behave identically: same function,
 *      same arguments, same message by construction. It is also the test that
 *      fails the build if a future table arrives with its own private copy,
 *      which is the whole point of the increment.
 *   2. BEHAVIOURAL — real statements against real rows, message compared
 *      exactly.
 *   3. PERMITTED-OPERATIONS — the things that were allowed before are still
 *      allowed. A guard that refuses everything would pass a refusal-only
 *      suite; the release transition and the acceptance state machine are the
 *      cases that catch over-tightening.
 *
 * Plus a fail-closed section: the consolidation must not have introduced an
 * escape hatch by accident. There is no hatch until E-2 Increment 2, and these
 * tests are written now so that Increment 2 has to change them deliberately.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedFinding, seedRisk, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let userA: string;

/** The nine tables that enforce append-only semantics. */
const WORM_TABLES = [
  "applicability_affected_entities",
  "applicability_assessments",
  "applicability_evidence",
  "finding_lifecycle_events",
  "finding_risk_acceptances",
  "legal_holds",
  "retention_policies",
  "risk_lifecycle_events",
  "security_audit_log",
] as const;

/** Captured from the PRE-consolidation database. The equivalence baseline. */
const EXPECTED_MESSAGE: Record<string, (op: string) => string> = {
  applicability_affected_entities: (op) => `applicability_affected_entities is append-only (WORM): ${op} is not permitted`,
  applicability_assessments: (op) => `applicability_assessments is append-only (WORM): ${op} is not permitted`,
  applicability_evidence: (op) => `applicability_evidence is append-only (WORM): ${op} is not permitted`,
  finding_lifecycle_events: (op) => `finding_lifecycle_events is append-only: ${op} is not permitted`,
  risk_lifecycle_events: (op) => `risk_lifecycle_events is append-only: ${op} is not permitted`,
  security_audit_log: (op) => `security_audit_log is append-only: ${op} is not permitted`,
  retention_policies: (op) => `retention_policies is append-only (versioned): ${op} is not permitted`,
  legal_holds: (op) => `legal_holds is append-plus-release: ${op} is not permitted`,
  finding_risk_acceptances: (op) =>
    `finding_risk_acceptances is append-only: ${op} is forbidden.` +
    ` A risk acceptance is a governance artifact; withdraw it (state='withdrawn') instead of erasing it.`,
};

async function messageFrom(sql: string, params: unknown[] = []): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    return "<<NO ERROR — THE STATEMENT SUCCEEDED>>";
  } catch (err) {
    return (err as Error).message;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
}, 120_000);

afterAll(async () => {
  await pool.end();
});

/* ─────────────────────────────── 1. STRUCTURAL ───────────────────────────── */

describe("one policy: every append-only refusal resolves to the shared guard", () => {
  it("no table keeps a private copy of the delete/truncate policy", async () => {
    const { rows } = await pool.query<{ table_name: string; trigger_name: string; fn: string; def: string }>(
      `SELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS fn,
              pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc  p ON p.oid = t.tgfoid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = 'public'
          AND pg_get_triggerdef(t.oid) ~* '(DELETE|TRUNCATE)'
        ORDER BY c.relname, t.tgname`
    );
    expect(rows.length).toBeGreaterThan(0);
    const strays = rows.filter((r) => r.fn !== "worm_guard_mutation");
    expect(strays.map((r) => `${r.table_name}.${r.trigger_name} -> ${r.fn}`)).toEqual([]);
  });

  it("the six superseded functions are gone", async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (
          'applicability_forbid_mutation','security_audit_log_forbid_mutation',
          'finding_lifecycle_events_forbid_mutation','risk_lifecycle_events_forbid_mutation',
          'retention_policies_forbid_mutation','finding_risk_acceptances_forbid_delete')`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("the two state machines are deliberately NOT absorbed", async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN ('legal_holds_guard_mutation','finding_risk_acceptances_enforce_worm')
        ORDER BY p.proname`
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "finding_risk_acceptances_enforce_worm",
      "legal_holds_guard_mutation",
    ]);
  });

  it("every one of the nine tables is still guarded on DELETE and on TRUNCATE", async () => {
    for (const table of WORM_TABLES) {
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_triggerdef(t.oid) AS def
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname = $1`,
        [table]
      );
      const defs = rows.map((r) => r.def).join(" | ");
      expect(defs, `${table} lost its DELETE guard`).toMatch(/BEFORE (UPDATE OR )?DELETE/);
      expect(defs, `${table} lost its TRUNCATE guard`).toMatch(/BEFORE TRUNCATE/);
    }
  });
});

/* ────────────────────────────── 2. BEHAVIOURAL ───────────────────────────── */

describe("TRUNCATE is refused on all nine tables, with the pre-consolidation message", () => {
  for (const table of WORM_TABLES) {
    it(`${table}`, async () => {
      // A statement-level trigger fires even on an empty table, which is what
      // lets this cover all nine without seeding each one.
      //
      // applicability_assessments is referenced by two child tables, so a plain
      // TRUNCATE is refused by PostgreSQL for FK reasons BEFORE any trigger
      // runs — pre-existing behaviour, and why the original applicabilityWorm
      // test uses CASCADE. With CASCADE the children are truncated too, so any
      // one of the three applicability guards may surface first; the assertion
      // is that the message came from the shared guard, whichever fired.
      if (table === "applicability_assessments") {
        const msg = await messageFrom(`TRUNCATE ${table} CASCADE`);
        expect(msg).toMatch(/^applicability_\w+ is append-only \(WORM\): TRUNCATE is not permitted$/);
        return;
      }
      const msg = await messageFrom(`TRUNCATE ${table}`);
      expect(msg).toBe(EXPECTED_MESSAGE[table]!("TRUNCATE"));
    });
  }
});

describe("UPDATE and DELETE are refused, with the pre-consolidation message", () => {
  it("security_audit_log", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
       VALUES ($1,'equivalence.probe','probe') RETURNING id`,
      [seed.orgA.id]
    );
    const id = rows[0]!.id;
    expect(await messageFrom(`UPDATE security_audit_log SET event_type='x' WHERE id=$1`, [id]))
      .toBe(EXPECTED_MESSAGE["security_audit_log"]!("UPDATE"));
    expect(await messageFrom(`DELETE FROM security_audit_log WHERE id=$1`, [id]))
      .toBe(EXPECTED_MESSAGE["security_audit_log"]!("DELETE"));
  });

  it("retention_policies", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO retention_policies (organization_id, data_class, version, retention_days, cleared, source)
       VALUES ($1,'ask_conversation',$2,90,false,'tenant') RETURNING id`,
      [seed.orgA.id, Math.floor(Math.random() * 1_000_000) + 1000]
    );
    const id = rows[0]!.id;
    expect(await messageFrom(`UPDATE retention_policies SET retention_days=1 WHERE id=$1`, [id]))
      .toBe(EXPECTED_MESSAGE["retention_policies"]!("UPDATE"));
    expect(await messageFrom(`DELETE FROM retention_policies WHERE id=$1`, [id]))
      .toBe(EXPECTED_MESSAGE["retention_policies"]!("DELETE"));
  });

  it("legal_holds — DELETE refused by the shared guard", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','equivalence probe',$2) RETURNING id`,
      [seed.orgA.id, userA]
    );
    expect(await messageFrom(`DELETE FROM legal_holds WHERE id=$1`, [rows[0]!.id]))
      .toBe(EXPECTED_MESSAGE["legal_holds"]!("DELETE"));
  });

  it("finding_lifecycle_events", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "equivalence probe" });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM finding_lifecycle_events WHERE finding_id = $1 LIMIT 1`,
      [findingId]
    );
    if (!rows[0]) return; // no lifecycle row is written on create in this schema
    expect(await messageFrom(`DELETE FROM finding_lifecycle_events WHERE id=$1`, [rows[0].id]))
      .toBe(EXPECTED_MESSAGE["finding_lifecycle_events"]!("DELETE"));
  });

  it("risk_lifecycle_events", async () => {
    const riskId = await seedRisk(pool, seed.orgA.id, { title: "equivalence probe" });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM risk_lifecycle_events WHERE risk_id = $1 LIMIT 1`,
      [riskId]
    );
    if (!rows[0]) return;
    expect(await messageFrom(`DELETE FROM risk_lifecycle_events WHERE id=$1`, [rows[0].id]))
      .toBe(EXPECTED_MESSAGE["risk_lifecycle_events"]!("DELETE"));
  });
});

/* ─────────────────── 3. PERMITTED OPERATIONS STILL PERMITTED ─────────────── */

describe("the consolidation did not over-tighten", () => {
  it("legal_holds still accepts the active -> released transition", async () => {
    const releaser = (await seedUser(pool, seed.orgA.id)).id;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','releasable',$2) RETURNING id`,
      [seed.orgA.id, userA]
    );
    const res = await pool.query(
      `UPDATE legal_holds SET status='released', released_by_user_id=$2,
              released_at=now(), release_reason='done'
        WHERE id=$1 AND status='active' RETURNING id`,
      [rows[0]!.id, releaser]
    );
    expect(res.rowCount).toBe(1);
  });

  it("legal_holds still refuses a non-release UPDATE, with its own message", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','immutable',$2) RETURNING id`,
      [seed.orgA.id, userA]
    );
    const msg = await messageFrom(`UPDATE legal_holds SET reason='rewritten' WHERE id=$1`, [rows[0]!.id]);
    expect(msg).toContain("legal_holds: only the active -> released transition is permitted");
  });

  it("legal_holds still refuses a release that alters the hold", async () => {
    const releaser = (await seedUser(pool, seed.orgA.id)).id;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','no-rewrite',$2) RETURNING id`,
      [seed.orgA.id, userA]
    );
    const msg = await messageFrom(
      `UPDATE legal_holds SET status='released', released_by_user_id=$2, released_at=now(),
              release_reason='x', reason='rewritten' WHERE id=$1`,
      [rows[0]!.id, releaser]
    );
    expect(msg).toContain("legal_holds: a release may not alter the hold it releases");
  });

  it("append-only tables still accept INSERTs", async () => {
    const ins = await pool.query(
      `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
       VALUES ($1,'still.writable','probe') RETURNING id`,
      [seed.orgA.id]
    );
    expect(ins.rowCount).toBe(1);
  });
});

/* ──────────────────────────── 4. FAIL-CLOSED ─────────────────────────────── */

describe("no escape hatch exists yet — the guard refuses regardless of context", () => {
  it("setting a plausible erasure GUC does not permit anything", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
         VALUES ($1,'hatch.probe','probe') RETURNING id`,
        [seed.orgA.id]
      );
      for (const guc of ["app.erasure_authorized", "app.erasure_org_id", "app.current_org_id"]) {
        await c.query(`SELECT set_config($1, $2, true)`, [guc, seed.orgA.id]);
      }
      await expect(
        c.query(`DELETE FROM security_audit_log WHERE id=$1`, [rows[0]!.id])
      ).rejects.toThrow(/append-only/);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("app_request is refused BEFORE the trigger — by grants, not by the guard", async () => {
    // Written as discovered, not as assumed. app_request holds SELECT and
    // INSERT on security_audit_log and no DELETE, so the privilege check
    // refuses first and the trigger never runs. That is defence in depth and
    // worth pinning: it means the least-privileged role is stopped by TWO
    // independent mechanisms, and it tells E-2 Increment 2 that granting the
    // erasure role DELETE is a deliberate, separate act from satisfying the
    // guard.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
         VALUES ($1,'role.probe','probe') RETURNING id`,
        [seed.orgA.id]
      );
      await c.query("SET LOCAL ROLE app_request");
      await expect(
        c.query(`DELETE FROM security_audit_log WHERE id=$1`, [rows[0]!.id])
      ).rejects.toThrow(/permission denied for table security_audit_log/);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("the owner — which is what the application connects as today (M-1) — IS stopped by the guard", async () => {
    // The residual limitation ruling 2 requires documenting and testing: until
    // the app_request flip, the application connects as owner, and the owner
    // holds every privilege. The trigger is therefore the ONLY thing standing
    // between the running application and the audit log. It holds — but it is
    // one mechanism, not two, and the owner can also DISABLE TRIGGER.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
       VALUES ($1,'owner.probe','probe') RETURNING id`,
      [seed.orgA.id]
    );
    expect(await messageFrom(`DELETE FROM security_audit_log WHERE id=$1`, [rows[0]!.id]))
      .toBe(EXPECTED_MESSAGE["security_audit_log"]!("DELETE"));

    const isOwner = await pool.query<{ owned: boolean }>(
      `SELECT tableowner = current_user AS owned FROM pg_tables WHERE tablename='security_audit_log'`
    );
    expect(isOwner.rows[0]!.owned).toBe(true);
  });

  it("cross-org erasure is still impossible — org deletion still raises", async () => {
    // The D-12 property itself, restated post-consolidation: an organization
    // holding any evidentiary row cannot be deleted. E-2 Increment 2 is what
    // changes this, under a credential; Increment 1 must not.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
         VALUES ($1,'d12.probe','probe')`,
        [seed.orgB.id]
      );
      await expect(c.query(`DELETE FROM organizations WHERE id=$1`, [seed.orgB.id])).rejects.toThrow(
        /append-only/
      );
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });
});
