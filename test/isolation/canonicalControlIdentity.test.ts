/**
 * canonicalControlIdentity.test.ts — VA-S4 Step 1 against real Postgres.
 *
 * Migrations 20261067/68/69 make their guarantees STRUCTURAL — CHECK
 * constraints, a publication-state trigger, foreign keys, and RLS. A unit test
 * with a mocked client cannot prove any of them; it can only prove the SQL was
 * sent. So the properties asserted here are the ones only a real database can
 * answer:
 *
 *   * publication authority: no published row without a named human;
 *   * immutability: published reference content cannot be edited, only
 *     superseded — the guarantee historical reconstruction rests on;
 *   * the alias space and the canonical space cannot overlap, and an alias
 *     resolves to exactly one canonical control, globally;
 *   * the AI boundary: a model-proposed mapping cannot reach `published`;
 *   * tenancy: a tenant's canonical identities never cross an org boundary,
 *     while the global reference content is legitimately shared;
 *   * and the join the whole step exists to make possible — tenant requirement
 *     → crosswalk → canonical control → tenant control — actually resolves.
 */

import crypto from "crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { CANONICAL_CONTROL_CORPUS } from "../../src/api/lib/controls/canonicalControlCorpus.js";
import { publishCanonicalControls } from "../../src/api/lib/controls/canonicalControlPublisher.js";
import { CROSSWALK_CORPORA } from "../../src/api/lib/controls/crosswalkCorpora.js";
import { NIST_CSF_1_1_CROSSWALK } from "../../src/api/lib/controls/nistCsfCrosswalk.js";

let seed: TestDbSeed;
let pool: Pool;
let publisherA: string;

// Every corpus in the registry — the publisher publishes them all in one
// governed act, so a per-framework count would under-assert the row total.
const CROSSWALK_ROWS = CROSSWALK_CORPORA.reduce(
  (n, corpus) =>
    n + corpus.entries.reduce((m, e) => m + e.canonical_control_slugs.length, 0),
  0
);

/** An aliased corpus entry — the template-load path needs one. */
const ALIASED = CANONICAL_CONTROL_CORPUS.find((c) => c.aliases.length > 0)!;
const ALIAS_KEY = ALIASED.aliases[0]!.alias_key;
const ALIASED_KEY = `securelogic:control:${ALIASED.slug}`;

async function asOrg<T>(orgId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function mkUser(orgId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, role, status)
     VALUES ($1, $2, 'admin', 'active') RETURNING id`,
    [orgId, `publisher-${crypto.randomUUID()}@isolation.test`]
  );
  return r.rows[0]!.id;
}

async function mkControl(orgId: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [orgId, name]
  );
  return r.rows[0]!.id;
}

async function count(table: string): Promise<number> {
  const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(r.rows[0]!.n);
}

/** The exact statement templateLoader issues for a newly-inserted control. */
async function recordTemplateIdentity(
  orgId: string,
  controlId: string,
  aliasKey: string
): Promise<number> {
  const r = await pool.query(
    `INSERT INTO control_canonical_identities
       (organization_id, control_id, canonical_control_id, provenance, confidence, evidence_ref)
     SELECT $1, $2, cc.id, 'template', 100, $3
       FROM canonical_control_aliases a
       JOIN canonical_controls cc ON cc.id = a.canonical_control_id
      WHERE a.alias_key = $3
        AND cc.status = 'published'
     ON CONFLICT (organization_id, control_id, canonical_control_id, provenance) DO NOTHING`,
    [orgId, controlId, aliasKey]
  );
  return r.rowCount ?? 0;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  publisherA = await mkUser(seed.orgA.id);
});

afterAll(async () => {
  await pool.end();
});

describe("publication — the governed entry path", () => {
  it("a dry run writes NOTHING, having really executed every statement", async () => {
    const result = await publishCanonicalControls(pool, { publishedByUserId: publisherA });
    expect(result.applied).toBe(false);
    expect(result.controls_published).toBe(CANONICAL_CONTROL_CORPUS.length);
    expect(await count("canonical_controls")).toBe(0);
    expect(await count("canonical_control_crosswalk")).toBe(0);
  });

  it("refuses to publish for a user that does not exist", async () => {
    await expect(
      publishCanonicalControls(pool, {
        publishedByUserId: "00000000-0000-4000-8000-000000000000",
        apply: true,
      })
    ).rejects.toThrow(/must name a real human/);
    expect(await count("canonical_controls")).toBe(0);
  });

  it("--apply publishes the corpus, its aliases and the crosswalk in one act", async () => {
    const result = await publishCanonicalControls(pool, {
      publishedByUserId: publisherA,
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(result.drift).toEqual([]);
    expect(result.alias_conflicts).toEqual([]);

    expect(await count("canonical_controls")).toBe(CANONICAL_CONTROL_CORPUS.length);
    expect(await count("canonical_control_crosswalk")).toBe(CROSSWALK_ROWS);

    const published = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM canonical_controls
        WHERE status = 'published' AND published_by_user_id = $1 AND published_at IS NOT NULL`,
      [publisherA]
    );
    expect(Number(published.rows[0]!.n)).toBe(CANONICAL_CONTROL_CORPUS.length);
  });

  it("is idempotent — a second --apply publishes nothing and reports no drift", async () => {
    const result = await publishCanonicalControls(pool, {
      publishedByUserId: publisherA,
      apply: true,
    });
    expect(result.controls_published).toBe(0);
    expect(result.controls_already_published).toBe(CANONICAL_CONTROL_CORPUS.length);
    expect(result.crosswalk_published).toBe(0);
    expect(result.crosswalk_already_present).toBe(CROSSWALK_ROWS);
    expect(result.drift).toEqual([]);
    expect(await count("canonical_controls")).toBe(CANONICAL_CONTROL_CORPUS.length);
    expect(await count("canonical_control_crosswalk")).toBe(CROSSWALK_ROWS);
  });
});

describe("authority is structural, not conventional", () => {
  it("a published control without a named publisher is rejected by the CHECK", async () => {
    await expect(
      pool.query(
        `INSERT INTO canonical_controls (canonical_key, display_name, status)
         VALUES ('securelogic:control:unauthorised', 'No publisher', 'published')`
      )
    ).rejects.toThrow(/publication_authority_check/);
  });

  it("a draft may not carry a publisher either — the CHECK is symmetric", async () => {
    await expect(
      pool.query(
        `INSERT INTO canonical_controls
           (canonical_key, display_name, status, published_by_user_id, published_at)
         VALUES ('securelogic:control:draft-with-publisher', 'Draft', 'draft', $1, NOW())`,
        [publisherA]
      )
    ).rejects.toThrow(/publication_authority_check/);
  });

  it("a model-proposed mapping cannot reach published without a human approver", async () => {
    const cc = await pool.query<{ id: string }>(
      `SELECT id FROM canonical_controls WHERE canonical_key = $1`,
      [ALIASED_KEY]
    );
    await expect(
      pool.query(
        `INSERT INTO canonical_control_crosswalk
           (framework_key, framework_version, requirement_reference, canonical_control_id,
            mapping_source, mapping_version, status, proposed_by_actor_kind)
         VALUES ('nist-csf', '1.1', 'ID.AM-1', $1, 'ai_proposed', 'test', 'published', 'ai_extraction')`,
        [cc.rows[0]!.id]
      )
    ).rejects.toThrow(/approval_authority_check/);
  });

  it("a model MAY propose — the boundary is publication, not participation", async () => {
    const cc = await pool.query<{ id: string }>(
      `SELECT id FROM canonical_controls WHERE canonical_key = $1`,
      [ALIASED_KEY]
    );
    const r = await pool.query(
      `INSERT INTO canonical_control_crosswalk
         (framework_key, framework_version, requirement_reference, canonical_control_id,
          mapping_source, mapping_version, status, proposed_by_actor_kind)
       VALUES ('nist-csf', '2.0', 'GV.OC-01', $1, 'ai_proposed', 'test', 'proposed', 'ai_extraction')
       RETURNING id`,
      [cc.rows[0]!.id]
    );
    expect(r.rowCount).toBe(1);
    await pool.query(`DELETE FROM canonical_control_crosswalk WHERE id = $1`, [r.rows[0]!.id]);
  });
});

describe("published reference content is immutable", () => {
  it("editing a published control's wording raises, directing the caller to supersede it", async () => {
    await expect(
      pool.query(
        `UPDATE canonical_controls SET display_name = 'Silently reworded' WHERE canonical_key = $1`,
        [ALIASED_KEY]
      )
    ).rejects.toThrow(/immutable once published/);
  });

  it("a published control may not be un-published", async () => {
    await expect(
      pool.query(`UPDATE canonical_controls SET status = 'draft' WHERE canonical_key = $1`, [
        ALIASED_KEY,
      ])
    ).rejects.toThrow(/may only move from published to superseded/);
  });

  it("a draft cannot skip straight to superseded — there is nothing to supersede", async () => {
    await pool.query(
      `INSERT INTO canonical_controls (canonical_key, display_name, status)
       VALUES ('securelogic:control:harness-draft', 'Harness draft', 'draft')`
    );
    await expect(
      pool.query(
        `UPDATE canonical_controls SET status = 'superseded'
          WHERE canonical_key = 'securelogic:control:harness-draft'`
      )
    ).rejects.toThrow(/cannot be superseded/);
  });
});

describe("the alias space can never become a second canonical namespace", () => {
  it("an alias spelled in the canonical namespace is rejected", async () => {
    const cc = await pool.query<{ id: string }>(
      `SELECT id FROM canonical_controls WHERE canonical_key = $1`,
      [ALIASED_KEY]
    );
    await expect(
      pool.query(
        `INSERT INTO canonical_control_aliases (canonical_control_id, alias_key, alias_scheme, source)
         VALUES ($1, 'securelogic:control:pretender', 'legacy', 'harness')`,
        [cc.rows[0]!.id]
      )
    ).rejects.toThrow(/not_canonical_namespace_check/);
  });

  it("one alias resolves to exactly one canonical control, globally", async () => {
    const other = CANONICAL_CONTROL_CORPUS.find((c) => c.slug !== ALIASED.slug)!;
    const cc = await pool.query<{ id: string }>(
      `SELECT id FROM canonical_controls WHERE canonical_key = $1`,
      [`securelogic:control:${other.slug}`]
    );
    await expect(
      pool.query(
        `INSERT INTO canonical_control_aliases (canonical_control_id, alias_key, alias_scheme, source)
         VALUES ($1, $2, 'legacy', 'harness')`,
        [cc.rows[0]!.id, ALIAS_KEY]
      )
    ).rejects.toThrow(/aliases_key_unique/);
  });
});

describe("the template-load path, end to end", () => {
  it("a template control whose slug is a published alias gains a canonical identity", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    expect(await recordTemplateIdentity(seed.orgA.id, controlId, ALIAS_KEY)).toBe(1);

    const r = await pool.query<{ provenance: string; canonical_key: string; evidence_ref: string }>(
      `SELECT i.provenance, i.evidence_ref, cc.canonical_key
         FROM control_canonical_identities i
         JOIN canonical_controls cc ON cc.id = i.canonical_control_id
        WHERE i.control_id = $1`,
      [controlId]
    );
    expect(r.rows[0]).toMatchObject({
      provenance: "template",
      canonical_key: ALIASED_KEY,
      evidence_ref: ALIAS_KEY,
    });
  });

  it("re-running the same load writes no second row", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    expect(await recordTemplateIdentity(seed.orgA.id, controlId, ALIAS_KEY)).toBe(1);
    expect(await recordTemplateIdentity(seed.orgA.id, controlId, ALIAS_KEY)).toBe(0);
  });

  it("an unregistered slug writes NOTHING — no canonical identity is a legitimate state", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    expect(await recordTemplateIdentity(seed.orgA.id, controlId, "b2b-ai:control:not-aliased")).toBe(0);
  });

  it("a DRAFT canonical control never claims a tenant control", async () => {
    await pool.query(
      `INSERT INTO canonical_controls (canonical_key, display_name, status)
       VALUES ('securelogic:control:harness-unpublished', 'Unpublished', 'draft')
       ON CONFLICT (canonical_key) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO canonical_control_aliases (canonical_control_id, alias_key, alias_scheme, source)
       SELECT id, 'harness:control:draft-only', 'legacy', 'harness'
         FROM canonical_controls WHERE canonical_key = 'securelogic:control:harness-unpublished'
       ON CONFLICT (alias_key) DO NOTHING`
    );
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    expect(await recordTemplateIdentity(seed.orgA.id, controlId, "harness:control:draft-only")).toBe(0);
  });

  it("a human attestation and a template claim COEXIST — neither clobbers the other", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    await recordTemplateIdentity(seed.orgA.id, controlId, ALIAS_KEY);
    await pool.query(
      `INSERT INTO control_canonical_identities
         (organization_id, control_id, canonical_control_id, provenance, confidence, attested_by_user_id)
       SELECT $1, $2, id, 'attestation', 100, $3 FROM canonical_controls WHERE canonical_key = $4`,
      [seed.orgA.id, controlId, publisherA, ALIASED_KEY]
    );
    const r = await pool.query<{ provenance: string }>(
      `SELECT provenance FROM control_canonical_identities WHERE control_id = $1 ORDER BY provenance`,
      [controlId]
    );
    expect(r.rows.map((x) => x.provenance)).toEqual(["attestation", "template"]);
  });

  it("an attestation without a named human is rejected, and a template claim with one is too", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    await expect(
      pool.query(
        `INSERT INTO control_canonical_identities
           (organization_id, control_id, canonical_control_id, provenance)
         SELECT $1, $2, id, 'attestation' FROM canonical_controls WHERE canonical_key = $3`,
        [seed.orgA.id, controlId, ALIASED_KEY]
      )
    ).rejects.toThrow(/attestation_actor_check/);

    await expect(
      pool.query(
        `INSERT INTO control_canonical_identities
           (organization_id, control_id, canonical_control_id, provenance, attested_by_user_id)
         SELECT $1, $2, id, 'template', $3 FROM canonical_controls WHERE canonical_key = $4`,
        [seed.orgA.id, controlId, publisherA, ALIASED_KEY]
      )
    ).rejects.toThrow(/attestation_actor_check/);
  });
});

describe("tenancy — global content is shared, tenant identities are not", () => {
  it("org B cannot see org A's canonical identity rows under RLS", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    await recordTemplateIdentity(seed.orgA.id, controlId, ALIAS_KEY);

    const visibleToA = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(`SELECT id FROM control_canonical_identities WHERE control_id = $1`, [controlId]))
        .rowCount
    );
    const visibleToB = await asOrg(seed.orgB.id, async (c) =>
      (await c.query(`SELECT id FROM control_canonical_identities WHERE control_id = $1`, [controlId]))
        .rowCount
    );
    expect(visibleToA).toBe(1);
    expect(visibleToB).toBe(0);
  });

  it("org B cannot forge a row into org A", async () => {
    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    await expect(
      asOrg(seed.orgB.id, async (c) =>
        c.query(
          `INSERT INTO control_canonical_identities
             (organization_id, control_id, canonical_control_id, provenance)
           SELECT $1, $2, id, 'customer_mapped' FROM canonical_controls WHERE canonical_key = $3`,
          [seed.orgA.id, controlId, ALIASED_KEY]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("the global reference content IS readable by every tenant — it holds no tenant data", async () => {
    for (const org of [seed.orgA.id, seed.orgB.id]) {
      const n = await asOrg(org, async (c) =>
        (await c.query(`SELECT id FROM canonical_controls WHERE status = 'published'`)).rowCount
      );
      expect(n).toBe(CANONICAL_CONTROL_CORPUS.length);
    }
  });

  it("a tenant may not write global reference content through the request role", async () => {
    await expect(
      asOrg(seed.orgA.id, async (c) =>
        c.query(
          `INSERT INTO canonical_controls (canonical_key, display_name, status)
           VALUES ('securelogic:control:tenant-forged', 'Forged', 'draft')`
        )
      )
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the join this step exists to make possible", () => {
  it("tenant requirement → crosswalk → canonical control → tenant control resolves", async () => {
    // A tenant framework carrying its CANONICAL identity, exactly as
    // frameworkActivation and templateLoader now write it.
    const fw = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, version, framework_key)
       VALUES ($1, 'NIST Cybersecurity Framework', '1.1', 'nist-csf') RETURNING id`,
      [seed.orgA.id]
    );
    const entry = NIST_CSF_1_1_CROSSWALK.find((e) =>
      e.canonical_control_slugs.includes(ALIASED.slug)
    );
    // If the aliased control carries no crosswalk row, this assertion has
    // nothing to prove — pick any mapped requirement instead.
    const reference = entry?.requirement_reference ?? NIST_CSF_1_1_CROSSWALK[0]!.requirement_reference;
    await pool.query(
      `INSERT INTO requirements (framework_id, reference_id, title) VALUES ($1, $2, $3)`,
      [fw.rows[0]!.id, reference, "Harness requirement"]
    );

    const controlId = await mkControl(seed.orgA.id, `Harness control ${crypto.randomUUID()}`);
    await recordTemplateIdentity(seed.orgA.id, controlId, ALIAS_KEY);

    const hop = await pool.query<{ control_id: string }>(
      `SELECT DISTINCT i.control_id
         FROM requirements r
         JOIN frameworks f ON f.id = r.framework_id
         JOIN canonical_control_crosswalk x
           ON x.framework_key = f.framework_key
          AND x.framework_version = f.version
          AND x.requirement_reference = r.reference_id
          AND x.status = 'published'
          AND x.superseded_at IS NULL
         JOIN control_canonical_identities i
           ON i.canonical_control_id = x.canonical_control_id
          AND i.organization_id = f.organization_id
        WHERE f.organization_id = $1 AND r.reference_id = $2`,
      [seed.orgA.id, reference]
    );
    expect(hop.rowCount).toBeGreaterThan(0);
    if (entry !== undefined) {
      expect(hop.rows.map((x) => x.control_id)).toContain(controlId);
    }
  });

  it("frameworks.framework_key must name a real registry entry", async () => {
    await expect(
      pool.query(
        `INSERT INTO frameworks (organization_id, name, version, framework_key)
         VALUES ($1, 'Invented', '1.1', 'not-a-framework')`,
        [seed.orgA.id]
      )
    ).rejects.toThrow(/frameworks_canonical_identity_fkey/);
  });

  it("a customer-authored framework with a NULL key is unconstrained — a legitimate state", async () => {
    const r = await pool.query(
      `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'Our Own Baseline', 'v1')
       RETURNING id`,
      [seed.orgA.id]
    );
    expect(r.rowCount).toBe(1);
  });
});


describe("the trust boundary, read out of the live catalog", () => {
  it("global reference tables carry no organization_id column at all", async () => {
    const r = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'organization_id'
          AND table_name IN ('canonical_controls', 'canonical_control_aliases',
                             'canonical_framework_versions', 'canonical_control_crosswalk')`
    );
    // Not "no tenant reads them" — they structurally cannot hold tenant data.
    expect(r.rows).toEqual([]);
  });

  it("the tenant-side table is the only one of the four+1 with RLS enabled", async () => {
    const r = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('canonical_controls', 'canonical_control_aliases',
                          'canonical_framework_versions', 'canonical_control_crosswalk',
                          'control_canonical_identities')
        ORDER BY relname`
    );
    const byName = Object.fromEntries(r.rows.map((x) => [x.relname, x.relrowsecurity]));
    expect(byName["control_canonical_identities"]).toBe(true);
    expect(byName["canonical_controls"]).toBe(false);
    expect(byName["canonical_control_aliases"]).toBe(false);
    expect(byName["canonical_framework_versions"]).toBe(false);
    expect(byName["canonical_control_crosswalk"]).toBe(false);
  });

  it("app_request holds SELECT only on global content, and full CRUD on its own tenant rows", async () => {
    const r = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_request'
          AND table_name IN ('canonical_controls', 'canonical_control_aliases',
                             'canonical_framework_versions', 'canonical_control_crosswalk',
                             'control_canonical_identities')`
    );
    const byTable = new Map<string, string[]>();
    for (const row of r.rows) {
      byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.privilege_type]);
    }
    for (const t of ["canonical_controls", "canonical_control_aliases",
                     "canonical_framework_versions", "canonical_control_crosswalk"]) {
      expect(byTable.get(t)!.sort(), t).toEqual(["SELECT"]);
    }
    expect(byTable.get("control_canonical_identities")!.sort()).toEqual([
      "DELETE", "INSERT", "SELECT", "UPDATE",
    ]);
  });
});

describe("one tenant's canonical mapping cannot reach another tenant", () => {
  it("two orgs implementing the SAME canonical control keep separate, non-leaking rows", async () => {
    const controlA = await mkControl(seed.orgA.id, `Shared-concept control A ${crypto.randomUUID()}`);
    const controlB = await mkControl(seed.orgB.id, `Shared-concept control B ${crypto.randomUUID()}`);
    await recordTemplateIdentity(seed.orgA.id, controlA, ALIAS_KEY);
    await recordTemplateIdentity(seed.orgB.id, controlB, ALIAS_KEY);

    // Same canonical control on both sides — the sharing is real.
    const canonical = await pool.query<{ n: string }>(
      `SELECT count(DISTINCT canonical_control_id)::text AS n
         FROM control_canonical_identities WHERE control_id IN ($1, $2)`,
      [controlA, controlB]
    );
    expect(Number(canonical.rows[0]!.n)).toBe(1);

    // And yet neither org can see the other's implementation of it. This is the
    // BOLA/IDOR question: a shared GLOBAL identifier must not become a handle
    // on another tenant's rows.
    const seenByA = await asOrg(seed.orgA.id, async (c) =>
      (
        await c.query(
          `SELECT control_id FROM control_canonical_identities
            WHERE canonical_control_id =
                  (SELECT id FROM canonical_controls WHERE canonical_key = $1)`,
          [ALIASED_KEY]
        )
      ).rows.map((x) => x.control_id)
    );
    const seenByB = await asOrg(seed.orgB.id, async (c) =>
      (
        await c.query(
          `SELECT control_id FROM control_canonical_identities
            WHERE canonical_control_id =
                  (SELECT id FROM canonical_controls WHERE canonical_key = $1)`,
          [ALIASED_KEY]
        )
      ).rows.map((x) => x.control_id)
    );
    expect(seenByA).toContain(controlA);
    expect(seenByA).not.toContain(controlB);
    expect(seenByB).toContain(controlB);
    expect(seenByB).not.toContain(controlA);
  });

  it("a tenant cannot reach another tenant's control through the crosswalk hop", async () => {
    // Org B runs the same hop query org A runs. The org predicate is on the
    // TENANT side of the join; the global crosswalk contributes no org.
    const rows = await asOrg(seed.orgB.id, async (c) =>
      (
        await c.query(
          `SELECT i.control_id
             FROM canonical_control_crosswalk x
             JOIN control_canonical_identities i
               ON i.canonical_control_id = x.canonical_control_id
            WHERE x.framework_key = 'nist-csf' AND x.status = 'published'`
        )
      ).rows
    );
    const orgAControls = await pool.query<{ control_id: string }>(
      `SELECT control_id FROM control_canonical_identities WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    const orgAIds = new Set(orgAControls.rows.map((x) => x.control_id));
    expect(orgAControls.rowCount).toBeGreaterThan(0);
    for (const row of rows) expect(orgAIds.has(row.control_id)).toBe(false);
  });
});

describe("publication fails closed on ambiguity", () => {
  it("an alias rebound to a different canonical control refuses the whole run", async () => {
    const other = CANONICAL_CONTROL_CORPUS.find((c) => c.slug !== ALIASED.slug)!;
    const before = await count("canonical_controls");

    // Simulate content that drifted underneath us: the alias now names a
    // DIFFERENT canonical control than the corpus says it does.
    await pool.query(`DELETE FROM canonical_control_aliases WHERE alias_key = $1`, [ALIAS_KEY]);
    await pool.query(
      `INSERT INTO canonical_control_aliases (canonical_control_id, alias_key, alias_scheme, source)
       SELECT id, $1, 'legacy', 'harness-drift' FROM canonical_controls WHERE canonical_key = $2`,
      [ALIAS_KEY, `securelogic:control:${other.slug}`]
    );

    await expect(
      publishCanonicalControls(pool, { publishedByUserId: publisherA, apply: true })
    ).rejects.toThrow(/alias identity conflict/);

    // Nothing committed, and the ambiguity is still there to be resolved.
    expect(await count("canonical_controls")).toBe(before);
    const bound = await pool.query<{ canonical_key: string }>(
      `SELECT cc.canonical_key FROM canonical_control_aliases a
         JOIN canonical_controls cc ON cc.id = a.canonical_control_id
        WHERE a.alias_key = $1`,
      [ALIAS_KEY]
    );
    expect(bound.rows[0]!.canonical_key).toBe(`securelogic:control:${other.slug}`);

    // Restore, and prove the same run succeeds once the ambiguity is gone.
    await pool.query(`DELETE FROM canonical_control_aliases WHERE alias_key = $1`, [ALIAS_KEY]);
    await pool.query(
      `INSERT INTO canonical_control_aliases (canonical_control_id, alias_key, alias_scheme, source)
       SELECT id, $1, $2, 'harness-restore' FROM canonical_controls WHERE canonical_key = $3`,
      [ALIAS_KEY, ALIASED.aliases[0]!.alias_scheme, ALIASED_KEY]
    );
    const ok = await publishCanonicalControls(pool, { publishedByUserId: publisherA, apply: true });
    expect(ok.alias_conflicts).toEqual([]);
  });

  it("a live mapping whose rationale changed underneath us refuses the run", async () => {
    const entry = NIST_CSF_1_1_CROSSWALK[0]!;
    const slug = entry.canonical_control_slugs[0]!;
    const key = `securelogic:control:${slug}`;

    const original = await pool.query(
      `SELECT * FROM canonical_control_crosswalk
        WHERE framework_key = 'nist-csf' AND framework_version = '1.1'
          AND requirement_reference = $1
          AND canonical_control_id = (SELECT id FROM canonical_controls WHERE canonical_key = $2)`,
      [entry.requirement_reference, key]
    );
    expect(original.rowCount).toBe(1);

    await pool.query(`DELETE FROM canonical_control_crosswalk WHERE id = $1`, [
      original.rows[0]!.id,
    ]);
    await pool.query(
      `INSERT INTO canonical_control_crosswalk
         (framework_key, framework_version, requirement_reference, canonical_control_id,
          mapping_source, mapping_rationale, mapping_version, status,
          proposed_by_actor_kind, approved_by_user_id, approved_at)
       SELECT 'nist-csf', '1.1', $1, id, 'securelogic', 'A justification nobody approved',
              'harness', 'published', 'securelogic_curator', $2, NOW()
         FROM canonical_controls WHERE canonical_key = $3`,
      [entry.requirement_reference, publisherA, key]
    );

    await expect(
      publishCanonicalControls(pool, { publishedByUserId: publisherA, apply: true })
    ).rejects.toThrow(/drifted crosswalk field/);

    // The drifted row is untouched — the publisher never repairs, only reports.
    const after = await pool.query<{ mapping_rationale: string }>(
      `SELECT mapping_rationale FROM canonical_control_crosswalk
        WHERE requirement_reference = $1
          AND canonical_control_id = (SELECT id FROM canonical_controls WHERE canonical_key = $2)`,
      [entry.requirement_reference, key]
    );
    expect(after.rows[0]!.mapping_rationale).toBe("A justification nobody approved");
  });
});
