/**
 * evidenceValidityPolicy.test.ts — VA-S4 step 3 against a real Postgres.
 *
 * The window arithmetic and the three ratified rules are unit-tested in
 * src/api/__tests__/evidenceValidityPolicy.test.ts. What can only be proven
 * here is what the DATABASE refuses regardless of any route — and, as in Step
 * 2, the database is currently the entire control, because step 3 ships with no
 * route either.
 *
 * The proofs, in the order the package's claims were made:
 *
 *   1. ONLY WHAT WAS RATIFIED IS SEEDED. Three D1 classes, and a Type I that
 *      carries NO duration rather than a guessed one. D2-D14 have no rows.
 *   2. THE CEILING IS ENFORCED BY THE DATABASE. Tightening is free; loosening
 *      past the platform ceiling is refused even to a caller that skips the
 *      contract module.
 *   3. AN UNRATIFIED CLASS CANNOT BE CONFIGURED AT ALL. No policy, no ceiling,
 *      no setting — rather than a silent fallback.
 *   4. HISTORY CANNOT BE REWRITTEN. Settings are append-and-supersede: identity
 *      and value frozen, no DELETE grant, platform policy read-only to the app.
 *   5. THE TENANT BOUNDARY HOLDS. One org can neither read nor write another's
 *      settings.
 *   6. NOTHING WAS BACKFILLED. D16: no evidence row gained a window.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";

/** Insert an org setting as the OWNER connection (RLS bypassed for setup). */
async function setSetting(
  orgId: string,
  assuranceClass: string,
  durationMonths: number,
  version = 1
): Promise<string> {
  const r = await pool.query(
    `INSERT INTO organization_evidence_validity_settings
       (organization_id, assurance_class, duration_months, version, set_by_user_id, reason)
     VALUES ($1,$2,$3,$4,$5,'test') RETURNING id`,
    [orgId, assuranceClass, durationMonths, version, userA]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the validity policy test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
}, 180_000);

afterAll(async () => {
  await pool?.end().catch(() => {});
});

describe("1. only what was ratified is seeded", () => {
  it("seeds exactly the three D1 classes and nothing else", async () => {
    const r = await pool.query(
      `SELECT assurance_class, default_duration_months, max_duration_months,
              min_duration_months, anchor, ratification_ref
         FROM evidence_validity_policy
        WHERE superseded_at IS NULL
        ORDER BY assurance_class`
    );
    expect(r.rows.map((x) => x.assurance_class)).toEqual(["soc1", "soc2_type1", "soc2_type2"]);
    expect(r.rows.every((x) => x.ratification_ref === "D1")).toBe(true);
  });

  it("soc2_type2 carries D1's ratified numbers", async () => {
    const r = await pool.query(
      `SELECT default_duration_months d, max_duration_months mx, min_duration_months mn, anchor
         FROM evidence_validity_policy
        WHERE assurance_class = 'soc2_type2' AND superseded_at IS NULL`
    );
    expect(r.rows[0]).toMatchObject({ d: 12, mx: 15, mn: 3, anchor: "report_period_end" });
  });

  it("soc2_type1 establishes NO window — the number D1 did not name is not invented", async () => {
    const r = await pool.query(
      `SELECT default_duration_months d, max_duration_months mx, anchor
         FROM evidence_validity_policy
        WHERE assurance_class = 'soc2_type1' AND superseded_at IS NULL`
    );
    expect(r.rows[0].d).toBeNull();
    expect(r.rows[0].mx).toBeNull();
    expect(r.rows[0].anchor).toBe("none");
  });

  it("no unratified class (D2-D14) has a policy row", async () => {
    const r = await pool.query(
      `SELECT count(*)::int n FROM evidence_validity_policy
        WHERE assurance_class NOT IN ('soc1','soc2_type1','soc2_type2')`
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("'unclassified' can never carry a policy", async () => {
    await expect(
      pool.query(
        `INSERT INTO evidence_validity_policy
           (assurance_class, version, default_duration_months, max_duration_months,
            min_duration_months, anchor, ratification_ref, ratified_on, notes)
         VALUES ('unclassified',1,12,15,3,'report_period_end','X',CURRENT_DATE,'n')`
      )
    ).rejects.toThrow();
  });

  it("a duration without its guardrails is refused", async () => {
    await expect(
      pool.query(
        `INSERT INTO evidence_validity_policy
           (assurance_class, version, default_duration_months, max_duration_months,
            min_duration_months, anchor, ratification_ref, ratified_on, notes)
         VALUES ('pen_test',1,12,NULL,NULL,'collected_at','X',CURRENT_DATE,'n')`
      )
    ).rejects.toThrow();
  });

  it("min <= default <= max is enforced", async () => {
    await expect(
      pool.query(
        `INSERT INTO evidence_validity_policy
           (assurance_class, version, default_duration_months, max_duration_months,
            min_duration_months, anchor, ratification_ref, ratified_on, notes)
         VALUES ('pen_test',1,20,15,3,'collected_at','X',CURRENT_DATE,'n')`
      )
    ).rejects.toThrow();
  });

  it("only ONE live version per class may exist", async () => {
    await expect(
      pool.query(
        `INSERT INTO evidence_validity_policy
           (assurance_class, version, default_duration_months, max_duration_months,
            min_duration_months, anchor, ratification_ref, ratified_on, notes)
         VALUES ('soc2_type2',2,9,15,3,'report_period_end','D1',CURRENT_DATE,'second live')`
      )
    ).rejects.toThrow();
  });
});

describe("2. 'policy_default' is a real basis with a real shape", () => {
  it("evidence accepts policy_default WITH an end date", async () => {
    const r = await pool.query(
      `INSERT INTO evidence
         (organization_id, source_type, source_id, title, evidence_type,
          validity_basis, valid_from, valid_until)
       VALUES ($1,'control_test', gen_random_uuid(), 'policy-windowed','document',
               'policy_default', DATE '2025-12-31', DATE '2026-12-31')
       RETURNING id`,
      [seed.orgA.id]
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  it("policy_default WITHOUT an end date is refused — a computed window must have an end", async () => {
    await expect(
      pool.query(
        `INSERT INTO evidence
           (organization_id, source_type, source_id, title, evidence_type,
            validity_basis, valid_until)
         VALUES ($1,'control_test', gen_random_uuid(), 'no-end','document',
                 'policy_default', NULL)`,
        [seed.orgA.id]
      )
    ).rejects.toThrow();
  });
});

describe("3. the ceiling is enforced by the database, not only the contract", () => {
  it("a customer may TIGHTEN below the platform floor", async () => {
    const id = await setSetting(seed.orgA.id, "soc2_type2", 1);
    expect(id).toBeTruthy();
    await pool.query("DELETE FROM organization_evidence_validity_settings WHERE id = $1", [id]);
  });

  it("a customer may loosen up to the ceiling", async () => {
    const id = await setSetting(seed.orgA.id, "soc2_type2", 15);
    expect(id).toBeTruthy();
    await pool.query("DELETE FROM organization_evidence_validity_settings WHERE id = $1", [id]);
  });

  it("loosening PAST the ceiling is refused", async () => {
    await expect(setSetting(seed.orgA.id, "soc2_type2", 16)).rejects.toThrow(/exceeds the platform ceiling/);
  });

  it("an unratified class cannot be configured at all", async () => {
    await expect(setSetting(seed.orgA.id, "pen_test", 12)).rejects.toThrow(/no live evidence_validity_policy/);
  });

  it("a class with a policy but NO ratified duration cannot be configured", async () => {
    await expect(setSetting(seed.orgA.id, "soc2_type1", 6)).rejects.toThrow(/NO ratified duration/);
  });

  it("only ONE live setting per (org, class)", async () => {
    const id = await setSetting(seed.orgA.id, "soc2_type2", 6, 1);
    await expect(setSetting(seed.orgA.id, "soc2_type2", 9, 2)).rejects.toThrow();
    await pool.query("DELETE FROM organization_evidence_validity_settings WHERE id = $1", [id]);
  });
});

describe("4. history cannot be rewritten", () => {
  it("a setting's value and identity are frozen — only superseded_at may change", async () => {
    const id = await setSetting(seed.orgA.id, "soc2_type2", 6);
    await expect(
      pool.query("UPDATE organization_evidence_validity_settings SET duration_months = 9 WHERE id = $1", [id])
    ).rejects.toThrow(/append-and-supersede/);
    await expect(
      pool.query("UPDATE organization_evidence_validity_settings SET assurance_class = 'soc1' WHERE id = $1", [id])
    ).rejects.toThrow(/append-and-supersede/);
    // Supersession itself is allowed.
    await pool.query("UPDATE organization_evidence_validity_settings SET superseded_at = NOW() WHERE id = $1", [id]);
    const r = await pool.query("SELECT superseded_at FROM organization_evidence_validity_settings WHERE id = $1", [id]);
    expect(r.rows[0].superseded_at).not.toBeNull();
    await pool.query("DELETE FROM organization_evidence_validity_settings WHERE id = $1", [id]);
  });

  it("app_request holds NO DELETE on settings and cannot write the platform policy", async () => {
    const r = await pool.query(
      `SELECT privilege_type, table_name
         FROM information_schema.role_table_grants
        WHERE grantee = 'app_request'
          AND table_name IN ('organization_evidence_validity_settings','evidence_validity_policy')`
    );
    const g = r.rows.map((x) => `${x.table_name}:${x.privilege_type}`);
    expect(g).not.toContain("organization_evidence_validity_settings:DELETE");
    expect(g).toContain("organization_evidence_validity_settings:INSERT");
    expect(g).toContain("evidence_validity_policy:SELECT");
    expect(g).not.toContain("evidence_validity_policy:INSERT");
    expect(g).not.toContain("evidence_validity_policy:UPDATE");
    expect(g).not.toContain("evidence_validity_policy:DELETE");
  });

  it("app_request's UPDATE grant is column-limited to superseded_at", async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE grantee = 'app_request'
          AND table_name = 'organization_evidence_validity_settings'
          AND privilege_type = 'UPDATE'
        ORDER BY column_name`
    );
    expect(r.rows.map((x) => x.column_name)).toEqual(["superseded_at"]);
  });

  it("neither new trigger claims DELETE or TRUNCATE — the shared WORM guard owns those", async () => {
    const r = await pool.query(
      `SELECT tgname, pg_get_triggerdef(oid) def FROM pg_trigger
        WHERE NOT tgisinternal AND tgname LIKE 'trg_org_evidence_validity%'`
    );
    expect(r.rowCount).toBe(2);
    for (const row of r.rows) {
      expect(row.def).not.toMatch(/DELETE|TRUNCATE/);
    }
  });
});

describe("5. the tenant boundary holds", () => {
  it("RLS is enabled with an org-scoped USING and WITH CHECK", async () => {
    const r = await pool.query(
      `SELECT qual, with_check FROM pg_policies
        WHERE tablename = 'organization_evidence_validity_settings'`
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].qual).toContain("app.current_org_id");
    expect(r.rows[0].with_check).toContain("app.current_org_id");
  });

  it("one org cannot read another's settings, and a blind session reads nothing", async () => {
    const idA = await setSetting(seed.orgA.id, "soc2_type2", 6);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const cross = await client.query(
        "SELECT id FROM organization_evidence_validity_settings WHERE organization_id = $1",
        [seed.orgA.id]
      );
      expect(cross.rowCount).toBe(0);

      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const blind = await client.query("SELECT id FROM organization_evidence_validity_settings");
      expect(blind.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    await pool.query("DELETE FROM organization_evidence_validity_settings WHERE id = $1", [idA]);
  });

  it("an org pinned to A cannot INSERT a setting for B", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      await expect(
        client.query(
          `INSERT INTO organization_evidence_validity_settings
             (organization_id, assurance_class, duration_months, version, reason)
           VALUES ($1,'soc2_type2',6,1,'cross-org')`,
          [seed.orgB.id]
        )
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the platform policy is readable by any tenant — it is global governed content", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const r = await client.query("SELECT count(*)::int n FROM evidence_validity_policy WHERE superseded_at IS NULL");
      expect(r.rows[0].n).toBe(3);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

describe("6. nothing was backfilled (D16)", () => {
  it("the migration created no org settings at all", async () => {
    const r = await pool.query(
      `SELECT count(*)::int n FROM organization_evidence_validity_settings WHERE reason <> 'test'`
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("no legacy evidence row was given a policy window by the migration", async () => {
    // Rows this suite created for the shape proof are excluded by title.
    const r = await pool.query(
      `SELECT count(*)::int n FROM evidence
        WHERE validity_basis = 'policy_default' AND title NOT IN ('policy-windowed')`
    );
    expect(r.rows[0].n).toBe(0);
  });
});
