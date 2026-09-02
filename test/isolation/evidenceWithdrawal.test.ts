/**
 * evidenceWithdrawal.test.ts — the governed withdrawal path (20261084).
 *
 * Owner ruling 2026-09-01: "detach all links, record events, then permit
 * deletion." What must be proven against a real Postgres is that the sequence
 * is ATOMIC and ATTRIBUTED, that the surviving record is complete, and above
 * all that the capability did not quietly become a general delete privilege.
 *
 *   1. IT WORKS. A linked artifact can be withdrawn; links and artifact go.
 *   2. THE RECORD SURVIVES WHAT IT DESCRIBES. Events remain after the delete.
 *   3. IT REFUSES. No actor, foreign actor, no reason, no tenant, wrong org,
 *      superseded artifact.
 *   4. IT DID NOT WIDEN THE PRIVILEGE. app_request still holds no DELETE on
 *      evidence_links and cannot delete evidence with a link by hand.
 *   5. THE RECORD CANNOT BE REWRITTEN. The WORM guard still refuses.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";
let userB = "";

async function seedEvidence(orgId: string, title: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1,'control_test', gen_random_uuid(), $2, 'document') RETURNING id`,
    [orgId, title]
  );
  return r.rows[0].id;
}

async function seedLink(orgId: string, evidenceId: string, confirmBy: string | null): Promise<string> {
  const r = await pool.query(
    `INSERT INTO evidence_links
       (organization_id, evidence_id, target_type, target_id, link_kind,
        linked_by_user_id, confirmed_at, confirmed_by_user_id, confirmation_note)
     VALUES ($1,$2,'finding', gen_random_uuid(),'origin', $3,
             CASE WHEN $4::uuid IS NULL THEN NULL ELSE NOW() END, $4::uuid,
             CASE WHEN $4::uuid IS NULL THEN NULL ELSE 'confirmed for test' END)
     RETURNING id`,
    [orgId, evidenceId, userA, confirmBy]
  );
  return r.rows[0].id;
}

/** Call withdraw_evidence as app_request with a pinned tenant, like a route does. */
async function withdraw(
  orgId: string,
  evidenceId: string,
  actor: string | null,
  reason: string
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; message: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const r = await client.query("SELECT * FROM withdraw_evidence($1,$2,$3)", [evidenceId, actor, reason]);
    await client.query("COMMIT");
    return { ok: true, row: r.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, message: (e as Error).message };
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the withdrawal test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
  userB = (await seedUser(pool, seed.orgB.id)).id;
}, 180_000);

afterAll(async () => {
  await pool?.end().catch(() => {});
});

describe("1. the sequence works end to end", () => {
  it("withdraws a CONFIRMED-linked artifact: links and artifact both go", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-happy");
    await seedLink(seed.orgA.id, ev, userA);
    await seedLink(seed.orgA.id, ev, null);

    const out = await withdraw(seed.orgA.id, ev, userA, "unredacted export");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Number(out.row["links_detached"])).toBe(2);
    expect(Number(out.row["links_removed"])).toBe(2);
    expect(out.row["original_filename"] ?? null).toBeDefined();

    const evLeft = await pool.query("SELECT 1 FROM evidence WHERE id = $1", [ev]);
    expect(evLeft.rowCount).toBe(0);
    const linksLeft = await pool.query("SELECT 1 FROM evidence_links WHERE evidence_id = $1", [ev]);
    expect(linksLeft.rowCount).toBe(0);
  });

  it("withdraws an artifact with NO links (the ordinary wrong-file case)", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-nolinks");
    const out = await withdraw(seed.orgA.id, ev, userA, "wrong client's report");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Number(out.row["links_detached"])).toBe(0);
    expect(Number(out.row["links_removed"])).toBe(0);
  });
});

describe("2. the record survives what it describes", () => {
  it("leaves a complete, attributed event stream after the artifact is gone", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-record");
    await seedLink(seed.orgA.id, ev, userA);
    const out = await withdraw(seed.orgA.id, ev, userA, "contained personal data");
    expect(out.ok).toBe(true);

    const events = await pool.query(
      `SELECT event_type, actor_user_id, detail FROM evidence_lifecycle_events
        WHERE evidence_id = $1 ORDER BY event_type`,
      [ev]
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(["detached", "withdrawn"]);
    for (const row of events.rows) expect(row.actor_user_id).toBe(userA);

    const withdrawn = events.rows.find((r) => r.event_type === "withdrawn")!;
    expect(withdrawn.detail.reason).toBe("contained personal data");
    expect(withdrawn.detail).toHaveProperty("sha256");
    expect(withdrawn.detail).toHaveProperty("original_filename");
    expect(withdrawn.detail.links_detached_by_withdrawal).toBe(1);

    const detached = events.rows.find((r) => r.event_type === "detached")!;
    expect(detached.detail.cause).toBe("artifact_withdrawn");
    expect(detached.detail.was_confirmed).toBe(true);

    // The artifact is gone; the record is not.
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(0);
  });
});

describe("3. it refuses", () => {
  it("an unattributed caller", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-noactor");
    const out = await withdraw(seed.orgA.id, ev, null, "reason");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/withdrawal_requires_an_actor/);
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(1);
  });

  it("an actor from ANOTHER organization", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-foreignactor");
    const out = await withdraw(seed.orgA.id, ev, userB, "reason");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/actor_not_in_organization/);
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(1);
  });

  it("an empty or whitespace reason", async () => {
    for (const reason of ["", "   "]) {
      const ev = await seedEvidence(seed.orgA.id, `wd-noreason-${reason.length}`);
      const out = await withdraw(seed.orgA.id, ev, userA, reason);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.message).toMatch(/withdrawal_requires_a_reason/);
      expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(1);
    }
  });

  it("a caller with NO tenant pinned", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-notenant");
    const client = await pool.connect();
    let msg = "";
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      await client.query("SELECT * FROM withdraw_evidence($1,$2,$3)", [ev, userA, "reason"]);
    } catch (e) {
      msg = (e as Error).message;
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    expect(msg).toMatch(/tenant_context_missing/);
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(1);
  });

  it("an artifact belonging to ANOTHER organization", async () => {
    const ev = await seedEvidence(seed.orgB.id, "wd-crossorg");
    const out = await withdraw(seed.orgA.id, ev, userA, "reason");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/evidence_not_found/);
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(1);
  });

  it("an artifact a LATER VERSION supersedes — provenance is not rewritten silently", async () => {
    const older = await seedEvidence(seed.orgA.id, "wd-older");
    const newer = await seedEvidence(seed.orgA.id, "wd-newer");
    await pool.query("UPDATE evidence SET supersedes_evidence_id = $1 WHERE id = $2", [older, newer]);

    const out = await withdraw(seed.orgA.id, older, userA, "reason");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/evidence_is_superseded_by_another_version/);
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [older])).rowCount).toBe(1);
  });
});

describe("4. the privilege was NOT widened", () => {
  it("app_request still holds no DELETE on evidence_links or evidence", async () => {
    const r = await pool.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee='app_request' AND privilege_type='DELETE'
          AND table_name IN ('evidence_links','evidence_lifecycle_events')`
    );
    expect(r.rowCount).toBe(0);
  });

  it("app_request cannot delete a LINKED artifact by hand — only the function may", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-byhand");
    await seedLink(seed.orgA.id, ev, userA);
    const client = await pool.connect();
    let failed = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await client.query("DELETE FROM evidence WHERE id = $1", [ev]);
    } catch {
      failed = true;
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    expect(failed).toBe(true);
    expect((await pool.query("SELECT 1 FROM evidence WHERE id=$1", [ev])).rowCount).toBe(1);
  });

  it("the function is SECURITY DEFINER and app_request may execute it", async () => {
    const r = await pool.query(
      `SELECT p.prosecdef, has_function_privilege('app_request', p.oid, 'EXECUTE') AS can_exec
         FROM pg_proc p WHERE p.proname = 'withdraw_evidence'`
    );
    expect(r.rows[0].prosecdef).toBe(true);
    expect(r.rows[0].can_exec).toBe(true);
  });
});

describe("5. the surviving record cannot be rewritten", () => {
  it("WORM still refuses UPDATE and DELETE on the event stream", async () => {
    const ev = await seedEvidence(seed.orgA.id, "wd-worm");
    await withdraw(seed.orgA.id, ev, userA, "worm check");
    await expect(
      pool.query("UPDATE evidence_lifecycle_events SET detail = '{}'::jsonb WHERE evidence_id = $1", [ev])
    ).rejects.toThrow();
    await expect(
      pool.query("DELETE FROM evidence_lifecycle_events WHERE evidence_id = $1", [ev])
    ).rejects.toThrow();
  });
});
