/**
 * requirementContentCuration.test.ts — VA-6 questionnaire content layer,
 * proven behaviorally against real Postgres with RLS live.
 *
 * What this file proves:
 *   - a custom question enters the scoping universe AT BIRTH (heuristic tags
 *     derived on POST, stamped as heuristic — never silently blank again),
 *   - curation (PATCH) is content-only: guidance and scope tags change,
 *     identity (reference_id, title) cannot,
 *   - curated tags are validated against the closed vocabulary and stamped
 *     source='curated',
 *   - framework activation tags its requirements at instantiation,
 *   - coverage reports only the caller's corpus,
 *   - none of it can cross a tenant boundary (requirements have no
 *     organization_id — isolation is the framework join, and these tests are
 *     what make that join's predicate impossible to delete quietly).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let frameworkA: string;
let frameworkB: string;
let requirementB: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });

  const mkFramework = async (orgId: string, name: string): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, version)
       VALUES ($1, $2, '1.0') RETURNING id`,
      [orgId, name]
    );
    return r.rows[0]!.id;
  };

  frameworkA = await mkFramework(seed.orgA.id, "Curation Harness A");
  frameworkB = await mkFramework(seed.orgB.id, "Curation Harness B");

  const reqB = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title)
     VALUES ($1, 'B-1', 'Org B question') RETURNING id`,
    [frameworkB]
  );
  requirementB = reqB.rows[0]!.id;

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

const post = (key: string, body: unknown) =>
  request(app).post("/api/requirements").set("X-Api-Key", key).send(body);
const patch = (key: string, id: string, body: unknown) =>
  request(app).patch(`/api/requirements/${id}`).set("X-Api-Key", key).send(body);

describe("a custom question enters the scoping universe at birth", () => {
  it("POST derives heuristic scope tags and stores guidance", async () => {
    const res = await post(seed.orgA.apiKey, {
      framework_id: frameworkA,
      reference_id: "CUSTOM-ACCESS-1",
      title: "Privileged access to production is reviewed quarterly",
      description: "Show us your quarterly privileged access review.",
    });
    expect(res.status).toBe(201);
    const req = res.body.requirement;
    expect(req.description).toBe(
      "Show us your quarterly privileged access review."
    );
    expect(Array.isArray(req.scope_tags)).toBe(true);
    expect(req.scope_tags.length).toBeGreaterThan(0);
    expect(req.scope_tags_source).toBe("heuristic");
    expect(req.scope_tags_at).not.toBeNull();
  });

  it("a title matching no pattern still gets the core fallback — never invisible", async () => {
    const res = await post(seed.orgA.apiKey, {
      framework_id: frameworkA,
      reference_id: "CUSTOM-BLAND-1",
      title: "Miscellaneous administrivia",
    });
    expect(res.status).toBe(201);
    expect(res.body.requirement.scope_tags).toContain("core");
  });
});

describe("curation is content-only and vocabulary-bound", () => {
  let target: string;

  beforeAll(async () => {
    const res = await post(seed.orgA.apiKey, {
      framework_id: frameworkA,
      reference_id: "CUR-1",
      title: "Encryption of data at rest",
    });
    target = res.body.requirement.id;
  });

  it("curating tags stamps source='curated' and updates guidance", async () => {
    const res = await patch(seed.orgA.apiKey, target, {
      description: "AES-256 or equivalent; provide the key-management policy.",
      scope_tags: ["encryption", "data-protection"],
    });
    expect(res.status).toBe(200);
    const req = res.body.requirement;
    expect(req.scope_tags).toEqual(["data-protection", "encryption"]);
    expect(req.scope_tags_source).toBe("curated");
    expect(req.description).toContain("AES-256");
  });

  it("a tag outside the closed vocabulary is refused", async () => {
    const res = await patch(seed.orgA.apiKey, target, {
      scope_tags: ["encryption", "blockchain-vibes"],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_scope_tags");
  });

  it("identity cannot be curated — title/reference_id are simply not updatable", async () => {
    const res = await patch(seed.orgA.apiKey, target, {
      title: "Renamed question",
      reference_id: "CUR-999",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("nothing_to_update");
    const row = await pool.query(
      `SELECT reference_id, title FROM requirements WHERE id = $1`,
      [target]
    );
    expect(row.rows[0]).toEqual({
      reference_id: "CUR-1",
      title: "Encryption of data at rest",
    });
  });

  it("clearing guidance is a legal curation (description: null)", async () => {
    const res = await patch(seed.orgA.apiKey, target, { description: null });
    expect(res.status).toBe(200);
    expect(res.body.requirement.description).toBeNull();
  });
});

describe("tenant isolation — the framework join is the boundary", () => {
  it("org A cannot curate org B's requirement (404, not 403)", async () => {
    const res = await patch(seed.orgA.apiKey, requirementB, {
      scope_tags: ["core"],
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("requirement_not_found");
    const row = await pool.query(
      `SELECT scope_tags_source FROM requirements WHERE id = $1`,
      [requirementB]
    );
    expect(row.rows[0]!.scope_tags_source).toBeNull();
  });

  it("org A cannot create a question under org B's framework", async () => {
    const res = await post(seed.orgA.apiKey, {
      framework_id: frameworkB,
      reference_id: "INTRUDER-1",
      title: "Should not exist",
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("framework_not_found");
  });

  it("coverage reports only the caller's corpus", async () => {
    const resA = await request(app)
      .get("/api/requirements/scope-tag-coverage")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(resA.status).toBe(200);
    expect(resA.body.overall.total).toBeGreaterThan(0);
    expect(Array.isArray(resA.body.vocabulary)).toBe(true);
    expect(resA.body.vocabulary).toContain("core");
    const frameworkIds = resA.body.frameworks.map(
      (f: { framework_id: string }) => f.framework_id
    );
    expect(frameworkIds).toContain(frameworkA);
    expect(frameworkIds).not.toContain(frameworkB);
  });
});

describe("framework activation tags at instantiation", () => {
  it("an activated template lands with tags, not empty arrays, honestly stamped", async () => {
    const res = await request(app)
      .post("/api/frameworks/activate")
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({ template_key: "soc2" });
    expect(res.status).toBe(200);
    expect(res.body.requirements_created).toBeGreaterThan(0);

    const rows = await pool.query<{
      scope_tags: string[];
      scope_tags_source: string | null;
    }>(
      `SELECT COALESCE(r.scope_tags,'{}') AS scope_tags, r.scope_tags_source
         FROM requirements r
        WHERE r.framework_id = $1`,
      [res.body.framework.id]
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.scope_tags.length).toBeGreaterThan(0);
      // SOC 2 carries no curated reference data, so every row is either a
      // genuine pattern match or the `core` fallback. The fallback rows are
      // stamped 'uncurated' rather than claiming a heuristic decided them —
      // several SOC 2 titles ("COSO Principle 1: Demonstrates commitment to
      // integrity and ethical values") match no pattern at all.
      expect(["heuristic", "uncurated"]).toContain(row.scope_tags_source);
      expect(row.scope_tags_source).not.toBe("curated");
    }
    expect(rows.rows.some((r) => r.scope_tags_source === "uncurated")).toBe(true);
    for (const row of rows.rows.filter((r) => r.scope_tags_source === "uncurated")) {
      expect(row.scope_tags).toEqual(["core"]);
    }
  });
});
