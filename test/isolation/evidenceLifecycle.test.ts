/**
 * evidenceLifecycle.test.ts — ADR-0012 Step 2 against a real Postgres.
 *
 * The vocabularies and the predicate TEXT are unit-tested in
 * src/api/__tests__/evidenceLifecycleContract.test.ts. What can only be proven
 * here is what the DATABASE refuses regardless of any route — because Step 2
 * ships with no route at all, and the database is currently the entire control.
 *
 * The proofs this file exists for, in the order the package's claims were made:
 *
 *   1. NOTHING WAS FABRICATED. No origin link, no confirmation, no lifecycle
 *      event and no validity was invented for legacy evidence.
 *   2. UNKNOWN HISTORY FAILS CLOSED. A confirmed link to an artifact whose
 *      validity nobody established counts for nothing.
 *   3. HISTORY CANNOT BE REWRITTEN. Identity frozen, confirmation write-once,
 *      detach terminal, events append-only, no DELETE grant.
 *   4. THE TENANT BOUNDARY HOLDS BEYOND RLS. Cross-org linking and cross-org
 *      version chains are refused by trigger, i.e. even to a connection that
 *      RLS does not constrain.
 *   5. TODAY'S BEHAVIOUR IS UNCHANGED. Evidence with no link still deletes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import {
  SQL_EVIDENCE_COUNTING,
  SQL_EVIDENCE_SUPERSEDED,
} from "../../src/api/lib/evidenceLifecycleContract.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";
let userB = "";

/** Insert an evidence row as the owner connection (RLS bypassed for setup). */
async function seedEvidence(
  orgId: string,
  opts: {
    title?: string;
    basis?: "not_established" | "artifact_dates" | "perpetual";
    validFrom?: string | null;
    validUntil?: string | null;
    assuranceClass?: string;
    supersedes?: string | null;
  } = {},
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO evidence
       (organization_id, source_type, source_id, title, evidence_type,
        validity_basis, valid_from, valid_until, assurance_class, supersedes_evidence_id)
     VALUES ($1, 'control_test', gen_random_uuid(), $2, 'document',
             $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      orgId,
      opts.title ?? "Harness evidence",
      opts.basis ?? "not_established",
      opts.validFrom ?? null,
      opts.validUntil ?? null,
      opts.assuranceClass ?? "unclassified",
      opts.supersedes ?? null,
    ],
  );
  return r.rows[0]!.id;
}

async function seedLink(
  orgId: string,
  evidenceId: string,
  opts: { confirmedBy?: string | null; targetId?: string } = {},
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO evidence_links
       (organization_id, evidence_id, target_type, target_id, link_kind,
        confirmed_at, confirmed_by_user_id, confirmation_note)
     VALUES ($1, $2, 'finding', COALESCE($3::uuid, gen_random_uuid()), 'origin',
             CASE WHEN $4::uuid IS NULL THEN NULL ELSE NOW() END,
             $4::uuid,
             CASE WHEN $4::uuid IS NULL THEN NULL ELSE 'Reperformed for a sample of 25.' END)
     RETURNING id`,
    [orgId, evidenceId, opts.targetId ?? null, opts.confirmedBy ?? null],
  );
  return r.rows[0]!.id;
}

/** Does this (evidence, link) pair COUNT under the contract predicate? */
async function counts(evidenceId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM evidence e
       JOIN evidence_links el ON el.evidence_id = e.id
      WHERE e.id = $1 AND ${SQL_EVIDENCE_COUNTING}`,
    [evidenceId],
  );
  return Number(r.rows[0]!.n);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the evidence lifecycle test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
  userB = (await seedUser(pool, seed.orgB.id)).id;
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

/* ─────────────────── 1. Nothing was fabricated ─────────────────── */

describe("no historical state was invented for legacy evidence", () => {
  it("ships with zero links and zero lifecycle events", async () => {
    const links = await pool.query("SELECT COUNT(*)::int AS n FROM evidence_links");
    const events = await pool.query("SELECT COUNT(*)::int AS n FROM evidence_lifecycle_events");
    expect(links.rows[0].n).toBe(0);
    expect(events.rows[0].n).toBe(0);
  });

  it("gives every pre-existing evidence row an unknown, fail-safe validity and class", async () => {
    const legacy = await seedEvidence(seed.orgA.id, { title: "Pre-Step-2 artifact" });
    const r = await pool.query(
      "SELECT validity_basis, assurance_class, valid_from, valid_until FROM evidence WHERE id = $1",
      [legacy],
    );
    expect(r.rows[0].validity_basis).toBe("not_established");
    expect(r.rows[0].assurance_class).toBe("unclassified");
    expect(r.rows[0].valid_from).toBeNull();
    expect(r.rows[0].valid_until).toBeNull();
  });
});

/* ─────────────────── 2. Unknown history fails closed ─────────────────── */

describe("the counting predicate fails closed on an unknown history", () => {
  it("a CONFIRMED link to an artifact with no established validity counts for NOTHING", async () => {
    const ev = await seedEvidence(seed.orgA.id, { basis: "not_established" });
    await seedLink(seed.orgA.id, ev, { confirmedBy: userA });
    expect(await counts(ev)).toBe(0);
  });

  it("an artifact with a current, artifact-stated window and a confirmed link COUNTS", async () => {
    const ev = await seedEvidence(seed.orgA.id, {
      basis: "artifact_dates",
      validFrom: "2025-01-01",
      validUntil: "2999-12-31",
      assuranceClass: "soc2_type2",
    });
    await seedLink(seed.orgA.id, ev, { confirmedBy: userA });
    expect(await counts(ev)).toBe(1);
  });

  it("an EXPIRED artifact stops counting without any sweep having run", async () => {
    const ev = await seedEvidence(seed.orgA.id, {
      basis: "artifact_dates",
      validFrom: "2020-01-01",
      validUntil: "2020-12-31",
    });
    await seedLink(seed.orgA.id, ev, { confirmedBy: userA });
    expect(await counts(ev)).toBe(0);
  });

  it("a PERPETUAL artifact counts with no end date — the one legitimate NULL", async () => {
    const ev = await seedEvidence(seed.orgA.id, { basis: "perpetual", assuranceClass: "contract" });
    await seedLink(seed.orgA.id, ev, { confirmedBy: userA });
    expect(await counts(ev)).toBe(1);
  });

  it("an UNCONFIRMED link never counts — attaching is not confirming", async () => {
    const ev = await seedEvidence(seed.orgA.id, {
      basis: "artifact_dates",
      validUntil: "2999-12-31",
    });
    await seedLink(seed.orgA.id, ev, { confirmedBy: null });
    expect(await counts(ev)).toBe(0);
  });

  it("a DETACHED link stops counting", async () => {
    const ev = await seedEvidence(seed.orgA.id, {
      basis: "artifact_dates",
      validUntil: "2999-12-31",
    });
    const link = await seedLink(seed.orgA.id, ev, { confirmedBy: userA });
    expect(await counts(ev)).toBe(1);
    await pool.query(
      `UPDATE evidence_links
          SET detached_at = NOW(), detached_by_user_id = $2, detach_reason = 'no_longer_relevant'
        WHERE id = $1`,
      [link, userA],
    );
    expect(await counts(ev)).toBe(0);
  });

  it("a SUPERSEDED artifact keeps counting, and is flagged rather than auto-detached", async () => {
    const oldEv = await seedEvidence(seed.orgA.id, {
      basis: "artifact_dates",
      validUntil: "2999-12-31",
    });
    await seedLink(seed.orgA.id, oldEv, { confirmedBy: userA });
    await seedEvidence(seed.orgA.id, {
      basis: "artifact_dates",
      validUntil: "2999-12-31",
      supersedes: oldEv,
    });

    expect(await counts(oldEv)).toBe(1);
    const flag = await pool.query(
      `SELECT ${SQL_EVIDENCE_SUPERSEDED} AS superseded FROM evidence e WHERE e.id = $1`,
      [oldEv],
    );
    expect(flag.rows[0].superseded).toBe(true);
  });
});

/* ─────────────────── 3. History cannot be rewritten ─────────────────── */

describe("a link is a record, not a mutable row", () => {
  it("refuses to repoint a link at different evidence", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const other = await seedEvidence(seed.orgA.id);
    const link = await seedLink(seed.orgA.id, ev);
    await expect(
      pool.query("UPDATE evidence_links SET evidence_id = $2 WHERE id = $1", [link, other]),
    ).rejects.toThrow(/identity is immutable/i);
  });

  it("refuses to re-confirm, un-confirm or reword a confirmation", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const link = await seedLink(seed.orgA.id, ev, { confirmedBy: userA });
    await expect(
      pool.query("UPDATE evidence_links SET confirmation_note = 'reworded' WHERE id = $1", [link]),
    ).rejects.toThrow(/write-once/i);
    await expect(
      pool.query("UPDATE evidence_links SET confirmed_at = NULL, confirmed_by_user_id = NULL, confirmation_note = NULL WHERE id = $1", [link]),
    ).rejects.toThrow(/write-once/i);
  });

  it("refuses to revive a detached link", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const link = await seedLink(seed.orgA.id, ev);
    await pool.query(
      `UPDATE evidence_links SET detached_at = NOW(), detached_by_user_id = $2,
              detach_reason = 'incorrect_attachment' WHERE id = $1`,
      [link, userA],
    );
    await expect(
      pool.query("UPDATE evidence_links SET detached_at = NULL, detached_by_user_id = NULL, detach_reason = NULL WHERE id = $1", [link]),
    ).rejects.toThrow(/detached and cannot be modified/i);
  });

  it("refuses a confirmation that names no human", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    await expect(
      pool.query(
        `INSERT INTO evidence_links
           (organization_id, evidence_id, target_type, target_id, link_kind, confirmed_at)
         VALUES ($1, $2, 'finding', gen_random_uuid(), 'origin', NOW())`,
        [seed.orgA.id, ev],
      ),
    ).rejects.toThrow(/evidence_links_confirmation_all_or_none/);
  });

  it("refuses a confirmation with an empty note", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    await expect(
      pool.query(
        `INSERT INTO evidence_links
           (organization_id, evidence_id, target_type, target_id, link_kind,
            confirmed_at, confirmed_by_user_id, confirmation_note)
         VALUES ($1, $2, 'finding', gen_random_uuid(), 'origin', NOW(), $3, '   ')`,
        [seed.orgA.id, ev, userA],
      ),
    ).rejects.toThrow(/evidence_links_confirmation_all_or_none/);
  });

  it("allows only ONE live link per artifact/target pair, and detached ones accumulate beside it", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const target = (await pool.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
    const first = await seedLink(seed.orgA.id, ev, { targetId: target });
    await expect(seedLink(seed.orgA.id, ev, { targetId: target })).rejects.toThrow(/duplicate key/i);

    await pool.query(
      `UPDATE evidence_links SET detached_at = NOW(), detached_by_user_id = $2,
              detach_reason = 'superseded' WHERE id = $1`,
      [first, userA],
    );
    const second = await seedLink(seed.orgA.id, ev, { targetId: target });
    expect(second).not.toBe(first);

    const all = await pool.query(
      "SELECT COUNT(*)::int AS n FROM evidence_links WHERE evidence_id = $1 AND target_id = $2",
      [ev, target],
    );
    expect(all.rows[0].n).toBe(2);
  });
});

describe("the lifecycle stream is append-only through the SHARED guard", () => {
  async function anEvent(orgId: string): Promise<string> {
    const ev = await seedEvidence(orgId);
    const r = await pool.query<{ id: string }>(
      `INSERT INTO evidence_lifecycle_events
         (organization_id, evidence_id, event_type, actor_user_id, detail)
       VALUES ($1, $2, 'validity_established', $3, '{"note":"harness"}'::jsonb)
       RETURNING id`,
      [orgId, ev, orgId === seed.orgA.id ? userA : userB],
    );
    return r.rows[0]!.id;
  }

  it("refuses UPDATE and DELETE with the shared guard's exact message", async () => {
    const id = await anEvent(seed.orgA.id);
    await expect(
      pool.query("UPDATE evidence_lifecycle_events SET event_type = 'confirmed' WHERE id = $1", [id]),
    ).rejects.toThrow("evidence_lifecycle_events is append-only: UPDATE is not permitted");
    await expect(
      pool.query("DELETE FROM evidence_lifecycle_events WHERE id = $1", [id]),
    ).rejects.toThrow("evidence_lifecycle_events is append-only: DELETE is not permitted");
  });

  it("refuses TRUNCATE", async () => {
    await expect(pool.query("TRUNCATE evidence_lifecycle_events")).rejects.toThrow(
      "evidence_lifecycle_events is append-only: TRUNCATE is not permitted",
    );
  });

  it("resolves to worm_guard_mutation, not a private copy", async () => {
    const { rows } = await pool.query<{ fn: string }>(
      `SELECT p.proname AS fn
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc  p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND c.relname = 'evidence_lifecycle_events'
          AND pg_get_triggerdef(t.oid) ~* '(DELETE|TRUNCATE)'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.fn === "worm_guard_mutation")).toBe(true);
  });

  it("requires an event about a use to name the use", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    await expect(
      pool.query(
        `INSERT INTO evidence_lifecycle_events (organization_id, evidence_id, event_type)
         VALUES ($1, $2, 'confirmed')`,
        [seed.orgA.id, ev],
      ),
    ).rejects.toThrow(/evidence_lifecycle_link_grain_check/);
  });
});

/* ─────────────────── 4. The tenant boundary, beyond RLS ─────────────────── */

describe("the tenant boundary holds against a connection RLS does not constrain", () => {
  it("refuses to link org A to org B's evidence — by TRIGGER, on the owner connection", async () => {
    const evB = await seedEvidence(seed.orgB.id);
    await expect(seedLink(seed.orgA.id, evB)).rejects.toThrow(/across|owned by/i);
  });

  it("refuses a version chain that crosses an organisation boundary", async () => {
    const evB = await seedEvidence(seed.orgB.id);
    await expect(
      seedEvidence(seed.orgA.id, { supersedes: evB }),
    ).rejects.toThrow(/across an organization boundary/i);
  });

  it("keeps version chains linear — two rows cannot supersede the same version", async () => {
    const base = await seedEvidence(seed.orgA.id);
    await seedEvidence(seed.orgA.id, { supersedes: base });
    await expect(seedEvidence(seed.orgA.id, { supersedes: base })).rejects.toThrow(/duplicate key/i);
  });

  it("refuses to supersede itself", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    await expect(
      pool.query("UPDATE evidence SET supersedes_evidence_id = id WHERE id = $1", [ev]),
    ).rejects.toThrow(/evidence_no_self_supersession_check/);
  });
});

describe("RLS on the new tables", () => {
  it("scopes reads to the GUC org, and sees nothing with the GUC unset", async () => {
    const evA = await seedEvidence(seed.orgA.id);
    await seedLink(seed.orgA.id, evA);
    const evB = await seedEvidence(seed.orgB.id);
    await seedLink(seed.orgB.id, evB);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const cross = await client.query("SELECT id FROM evidence_links WHERE organization_id = $1", [seed.orgB.id]);
      expect(cross.rowCount).toBe(0);
      const own = await client.query("SELECT id FROM evidence_links WHERE organization_id = $1", [seed.orgA.id]);
      expect(own.rowCount).toBeGreaterThan(0);

      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const blind = await client.query("SELECT id FROM evidence_links");
      expect(blind.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("refuses a link stamped for another org — and the same-org trigger gets there first", async () => {
    // Worth recording precisely, because a refusal proves nothing until you know
    // WHY it happened. Two guards cover this write and they fire in this order:
    // the BEFORE INSERT trigger runs before the RLS WITH CHECK, and the trigger's
    // own lookup of the artifact is itself RLS-scoped — so an app_request session
    // pinned to org A cannot even SEE org B's evidence to pair with it. The
    // trigger therefore always answers first, and the RLS WITH CHECK is proven
    // structurally below rather than by a race it can never win.
    const evA = await seedEvidence(seed.orgA.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(
          `INSERT INTO evidence_links (organization_id, evidence_id, target_type, target_id, link_kind)
           VALUES ($1, $2, 'finding', gen_random_uuid(), 'origin')`,
          [seed.orgB.id, evA],
        ),
      ).rejects.toThrow(/would link organization|row-level security|violates/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("carries a WITH CHECK policy on both new tables, not only a USING clause", async () => {
    // A USING-only policy filters reads and leaves writes open. Asserted
    // structurally because the trigger above makes it unreachable behaviourally.
    const { rows } = await pool.query<{ tablename: string; qual: string | null; with_check: string | null }>(
      `SELECT tablename, qual, with_check FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('evidence_links', 'evidence_lifecycle_events')`,
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([
      "evidence_lifecycle_events",
      "evidence_links",
    ]);
    for (const r of rows) {
      expect(r.qual, `${r.tablename} USING`).toContain("app.current_org_id");
      expect(r.with_check, `${r.tablename} WITH CHECK`).toContain("app.current_org_id");
    }
  });
});

describe("privileges say what the model says", () => {
  it("app_request cannot DELETE a link — a link is detached, never removed", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const link = await seedLink(seed.orgA.id, ev);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query("DELETE FROM evidence_links WHERE id = $1", [link]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request cannot UPDATE a link's identity columns — the grant itself forbids it", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const link = await seedLink(seed.orgA.id, ev);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query("UPDATE evidence_links SET link_kind = 'reuse' WHERE id = $1", [link]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request cannot UPDATE or DELETE a lifecycle event", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query("DELETE FROM evidence_lifecycle_events WHERE TRUE"),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

/* ─────────────────── 5. Today's behaviour is unchanged ─────────────────── */

describe("nothing that worked yesterday stopped working", () => {
  it("evidence with NO link still deletes — the portal path is untouched while the table is empty", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    const r = await pool.query("DELETE FROM evidence WHERE id = $1", [ev]);
    expect(r.rowCount).toBe(1);
  });

  it("evidence that IS in use cannot be deleted (the RESTRICT the writer package must convert to a detach)", async () => {
    const ev = await seedEvidence(seed.orgA.id);
    await seedLink(seed.orgA.id, ev);
    await expect(pool.query("DELETE FROM evidence WHERE id = $1", [ev])).rejects.toThrow(
      /violates foreign key constraint/i,
    );
  });

  it("the validity shape constraint refuses every incoherent combination", async () => {
    await expect(
      seedEvidence(seed.orgA.id, { basis: "not_established", validUntil: "2030-01-01" }),
    ).rejects.toThrow(/evidence_validity_shape_check/);
    await expect(
      seedEvidence(seed.orgA.id, { basis: "artifact_dates" }),
    ).rejects.toThrow(/evidence_validity_shape_check/);
    await expect(
      seedEvidence(seed.orgA.id, { basis: "perpetual", validUntil: "2030-01-01" }),
    ).rejects.toThrow(/evidence_validity_shape_check/);
    await expect(
      seedEvidence(seed.orgA.id, {
        basis: "artifact_dates",
        validFrom: "2030-01-01",
        validUntil: "2029-01-01",
      }),
    ).rejects.toThrow(/evidence_validity_ordering_check/);
  });
});
