/**
 * curatedFrameworkActivation.test.ts — framework activation consumes the
 * curated reference data, proven against real Postgres.
 *
 * The unit test (`src/api/__tests__/curatedFrameworkTags.test.ts`) proves the
 * MAP is right. This file proves the map is actually REACHED: that activating
 * GDPR / CCPA / NIST AI RMF writes curated rows and curated domains into the
 * database, that a template nobody has curated still activates and is honestly
 * stamped, and that the `uncurated` value the code writes is a value the
 * column's CHECK accepts.
 *
 * The defect it guards against is specific and was live: activating the
 * AI-governance framework produced four `core` rows, an EMPTY AI question set,
 * and four extra questions in the security set — with nothing in the database
 * to distinguish them from requirements a human had classified as security.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  ALL_CURATED_FRAMEWORK_TAGS,
  CURATED_TEMPLATE_KEYS,
} from "../../src/api/lib/vendorRisk/curatedFrameworkTags.js";
import { SCOPE_TAG_SOURCES } from "../../src/api/lib/vendorRisk/requirementScopeTags.js";
import { domainForScopeTags } from "../../src/api/lib/vendorRisk/requirementDomain.js";
import { canonicalFrameworkKeyFor } from "../../src/api/lib/controls/canonicalFrameworkIdentity.js";
import { FRAMEWORK_TEMPLATES } from "../../src/api/lib/frameworkTemplates.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type Row = { reference_id: string; scope_tags: string[]; scope_tags_source: string | null };

const activate = (key: string, template: string) =>
  request(app).post("/api/frameworks/activate").set("X-Api-Key", key).send({ template_key: template });

async function rowsOf(frameworkId: string): Promise<Row[]> {
  const r = await pool.query<Row>(
    `SELECT reference_id, COALESCE(scope_tags,'{}') AS scope_tags, scope_tags_source
       FROM requirements WHERE framework_id = $1 ORDER BY reference_id`,
    [frameworkId]
  );
  return r.rows;
}

/** Activate and return the rows as written. */
async function activated(apiKey: string, template: string): Promise<{ id: string; rows: Row[] }> {
  const res = await activate(apiKey, template);
  expect(res.status, `${template}: ${JSON.stringify(res.body)}`).toBe(200);
  const id = res.body.framework.id as string;
  return { id, rows: await rowsOf(id) };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("activation writes the curated reference data", () => {
  it.each(CURATED_TEMPLATE_KEYS)("%s activates fully curated", async (template) => {
    const { rows } = await activated(seed.orgA.apiKey, template);
    const expected = ALL_CURATED_FRAMEWORK_TAGS[template]!;

    expect(rows).toHaveLength(Object.keys(expected).length);
    for (const row of rows) {
      const entry = expected[row.reference_id];
      expect(entry, `${template}/${row.reference_id} was written but is not curated`).toBeDefined();
      expect([...row.scope_tags].sort(), `${template}/${row.reference_id}`).toEqual([...entry!.tags].sort());
      expect(row.scope_tags_source, `${template}/${row.reference_id}`).toBe("curated");
      // The domain the vendor is actually asked under, computed from what the
      // DATABASE holds — not from the map in memory.
      expect(domainForScopeTags(row.scope_tags), `${template}/${row.reference_id}`).toBe(entry!.domain);
    }
  });

  it("the AI framework produces an AI question set, not four security questions", async () => {
    const { rows } = await activated(seed.orgA.apiKey, "nist_ai_rmf");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.reference_id).sort()).toEqual(["GOVERN", "MANAGE", "MAP", "MEASURE"]);
    for (const row of rows) {
      expect(domainForScopeTags(row.scope_tags), row.reference_id).toBe("ai");
      expect(row.scope_tags, row.reference_id).not.toEqual(["core"]);
    }
  });

  it("the security domain gains exactly the two deliberate regulatory requirements plus the Core Assurance security objectives across all 40", async () => {
    const byDomain: Record<string, string[]> = {};
    for (const template of CURATED_TEMPLATE_KEYS) {
      const { rows } = await activated(seed.orgA.apiKey, template);
      for (const row of rows) {
        const d = domainForScopeTags(row.scope_tags);
        (byDomain[d] ??= []).push(`${template}/${row.reference_id}`);
      }
    }
    expect(Object.values(byDomain).flat()).toHaveLength(40);
    const regulatorySecurity = byDomain["security"]!.filter((k) => !k.startsWith("securelogic_core_assurance/")).sort();
    expect(regulatorySecurity).toEqual(["ccpa/CCPA-8", "gdpr/Art-32"]);
    expect(byDomain["security"]!.filter((k) => k.startsWith("securelogic_core_assurance/"))).toHaveLength(13);
    expect(byDomain["privacy"]).toHaveLength(18); // 17 regulatory + CAS-16
    expect(byDomain["ai"]).toHaveLength(4);
    expect(byDomain["nth_party"]!.sort()).toEqual(["gdpr/Art-28", "securelogic_core_assurance/CAS-11"]);
    expect(byDomain["resilience"]).toEqual(["securelogic_core_assurance/CAS-10"]);
  });

  it("re-activating is idempotent — curated rows are not rewritten or duplicated", async () => {
    const first = await activated(seed.orgA.apiKey, "gdpr");
    const second = await activated(seed.orgA.apiKey, "gdpr");
    expect(second.id).toBe(first.id);
    expect(second.rows).toEqual(first.rows);
  });
});

describe("an uncurated template is stamped honestly, not silently classified", () => {
  it("activates, and every row is heuristic or uncurated — never curated", async () => {
    const { rows } = await activated(seed.orgB.apiKey, "cis_v8");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.scope_tags.length, row.reference_id).toBeGreaterThan(0);
      expect(["heuristic", "uncurated"], row.reference_id).toContain(row.scope_tags_source);
    }
    expect(rows.some((r) => r.scope_tags_source === "uncurated")).toBe(true);
  });

  it("an 'uncurated' row holds core by fallback, and says so", async () => {
    const { rows } = await activated(seed.orgB.apiKey, "cis_v8");
    for (const row of rows.filter((r) => r.scope_tags_source === "uncurated")) {
      // The fallback is preserved — `core` is the whole tier-4 baseline, and an
      // untagged requirement is invisible to every tier below 1.
      expect(row.scope_tags, row.reference_id).toEqual(["core"]);
    }
  });

  it("unknown is distinguishable from deliberate security IN THE DATABASE", async () => {
    const unknown = await activated(seed.orgB.apiKey, "cis_v8");
    const deliberate = await activated(seed.orgA.apiKey, "ccpa");

    const unknownRow = unknown.rows.find((r) => r.scope_tags_source === "uncurated")!;
    const deliberateRow = deliberate.rows.find((r) => r.reference_id === "CCPA-8")!;

    // Identical tags, identical resulting domain...
    expect(unknownRow.scope_tags).toEqual(["core"]);
    expect(deliberateRow.scope_tags).toEqual(["core"]);
    expect(domainForScopeTags(unknownRow.scope_tags)).toBe("security");
    expect(domainForScopeTags(deliberateRow.scope_tags)).toBe("security");
    // ...and before this package they were the same row. Now they are not.
    expect(unknownRow.scope_tags_source).toBe("uncurated");
    expect(deliberateRow.scope_tags_source).toBe("curated");
  });
});

describe("the source vocabulary and the column CHECK move together", () => {
  it("SCOPE_TAG_SOURCES equals the CHECK list, read from pg_constraint", async () => {
    const r = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname = 'requirements_scope_tags_source_check'`
    );
    expect(r.rowCount, "the CHECK constraint is missing").toBe(1);
    const def = r.rows[0]!.def;
    const inDb = [...def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]!).sort();
    expect([...new Set(inDb)]).toEqual([...SCOPE_TAG_SOURCES].sort());
  });

  it("the database accepts 'uncurated' and refuses a value outside the set", async () => {
    const fw = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, version)
       VALUES ($1, 'Curated Activation Harness', '1.0') RETURNING id`,
      [seed.orgA.id]
    );
    const frameworkId = fw.rows[0]!.id;

    const ok = await pool.query<{ scope_tags_source: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title, scope_tags, scope_tags_source)
       VALUES ($1, 'UNC-1', 'Facilities Signage and Wayfinding', ARRAY['core'], 'uncurated')
       RETURNING scope_tags_source`,
      [frameworkId]
    );
    expect(ok.rows[0]!.scope_tags_source).toBe("uncurated");

    await expect(
      pool.query(
        `INSERT INTO requirements (framework_id, reference_id, title, scope_tags, scope_tags_source)
         VALUES ($1, 'UNC-2', 'Anything', ARRAY['core'], 'guessed')`,
        [frameworkId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });
});


// ====================================================================
// VA-S4 Step 1 — the canonical framework identity
// ====================================================================

describe("activation persists the CANONICAL framework identity, not just a display name", () => {
  it("every activatable template writes a framework_key the registry FK accepts", async () => {
    for (const template of Object.keys(FRAMEWORK_TEMPLATES)) {
      const res = await activate(seed.orgB.apiKey, template);
      expect(res.status, `${template}: ${JSON.stringify(res.body)}`).toBe(200);

      const r = await pool.query<{ name: string; version: string; framework_key: string | null }>(
        `SELECT name, version, framework_key FROM frameworks WHERE id = $1`,
        [res.body.framework.id]
      );
      const row = r.rows[0]!;
      // Non-null, and exactly what the module resolves — the join key from a
      // tenant requirement to the global crosswalk. `name` stays a display
      // string and is never the join key.
      expect(row.framework_key, template).toBe(canonicalFrameworkKeyFor(row.name, row.version));
      expect(row.framework_key, template).not.toBeNull();
    }
  });

  it("re-activating never nulls a key an earlier activation resolved", async () => {
    const first = await activate(seed.orgB.apiKey, "soc2");
    expect(first.status).toBe(200);
    const id = first.body.framework.id as string;

    await pool.query(`UPDATE frameworks SET name = 'Renamed by the customer' WHERE id = $1`, [id]);
    const again = await activate(seed.orgB.apiKey, "soc2");
    expect(again.status).toBe(200);

    const r = await pool.query<{ framework_key: string | null }>(
      `SELECT framework_key FROM frameworks WHERE id = $1`,
      [id]
    );
    // The rename cannot reach the canonical identity: COALESCE keeps it, and a
    // renamed row is exactly the case a mutable display string cannot survive.
    expect(r.rows[0]!.framework_key).toBe("soc2");
  });
});
