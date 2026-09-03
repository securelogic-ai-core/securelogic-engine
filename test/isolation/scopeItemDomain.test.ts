/**
 * scopeItemDomain.test.ts — VA-Q2 P2: domain first-class on scope items
 * (migration 20261062), driven through the real app over a throwaway DB.
 *
 * Proves, against Postgres:
 *   - a NEW engagement (stamped scope-rule 1.1.0) writes a non-NULL domain from
 *     the closed set on every item, and `GET /:id` + `GET /:id/responses`
 *     report `domains` counts that sum to the item count;
 *   - an engagement stamped 1.0.0 (pre-Q2) re-resolves with NULL on every item
 *     and reports `domains: null` — no backfill, no fabricated history;
 *   - the DB CHECK is the closed vocabulary (a bogus value is refused);
 *   - the freeze is unaffected: an issued engagement still 409s on re-resolve
 *     and its stamped question_set_hash still says `match` (the hash canon
 *     excludes `domain`);
 *   - tenant boundary: org B gets 404 on org A's engagement, and under org B's
 *     RLS session org A's domain rows are invisible (the column inherits the
 *     table's policy — no new policy was added);
 *   - the migration is idempotent (re-applying it is a no-op).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import { ASSESSMENT_DOMAINS } from "../../src/api/lib/vendorRisk/requirementDomain.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

const asA = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

/** Tier-1 intake: every activated requirement lands in scope (S1 "*"). */
const TIER1_INTAKE = {
  engagement_type: "initial",
  data_sensitivity: "restricted", data_volume: "large", access_level: "admin",
  operational_dependency: "critical", recoverability: "weeks", business_criticality: "critical",
  regulatory_exposure: "high", regulatory_breach_notification: true,
  ai_involvement: "embedded", ai_autonomy: "none", hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "high", concentration: "low",
};

type Fx = { vendorId: string; frameworkId: string; requirementIds: Record<string, string> };
let fxA: Fx;
let fxB: Fx;

/** One requirement per domain-bearing tag, plus a curated-only P2 tag. */
const REQS: Array<[string, string, string[]]> = [
  ["VA-1", "Security policy", ["core"]],
  ["VA-2", "Personal data handling", ["privacy"]],
  ["VA-3", "Model governance", ["ai-governance"]],
  ["VA-4", "Continuity", ["resilience"]],
  ["VA-5", "Sub-processor register", ["subprocessor"]],
  ["VA-6", "Lawful basis for processing", ["lawful-basis"]],
];

async function seedOrg(orgId: string, label: string): Promise<Fx> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor`, criticality: "critical" });
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  const requirementIds: Record<string, string> = {};
  for (const [ref, title, tags] of REQS) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
       VALUES ($1, $2, $3, 'guidance', $4::text[], 'curated', NOW()) RETURNING id`,
      [fw.rows[0]!.id, ref, title, tags]
    );
    requirementIds[ref] = r.rows[0]!.id;
  }
  return { vendorId, frameworkId: fw.rows[0]!.id, requirementIds };
}

async function createEngagement(who: typeof asA, fx: Fx, title: string): Promise<string> {
  const created = await who("post", "/api/vendor-engagements").send({ ...TIER1_INTAKE, vendor_id: fx.vendorId, title });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id as string;
}

async function domainRows(engagementId: string): Promise<Array<{ requirement_id: string; domain: string | null }>> {
  const r = await pool.query<{ requirement_id: string; domain: string | null }>(
    `SELECT requirement_id, domain FROM vendor_engagement_scope_items WHERE engagement_id = $1 ORDER BY requirement_id`,
    [engagementId]
  );
  return r.rows;
}

function migrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "../../db/migrations/20261062_scope_item_domain.sql"), "utf8");
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  fxA = await seedOrg(seed.orgA.id, "Q2P2-A");
  fxB = await seedOrg(seed.orgB.id, "Q2P2-B");
  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool.end();
});

describe("VA-Q2 P2 · a new engagement stamps a domain on every item", () => {
  let id: string;

  it("resolving scope under 1.1.0 writes a non-NULL domain from the closed set on EVERY item", async () => {
    id = await createEngagement(asA, fxA, "q2p2-new");
    const scoped = await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
    expect(scoped.body.scope_rule_version).toBe("1.1.0");

    const rows = await domainRows(id);
    expect(rows.length).toBe(REQS.length);
    for (const row of rows) {
      expect(row.domain, row.requirement_id).not.toBeNull();
      expect(ASSESSMENT_DOMAINS as readonly string[]).toContain(row.domain);
    }
    const byReq = new Map(rows.map((r) => [r.requirement_id, r.domain]));
    expect(byReq.get(fxA.requirementIds["VA-1"]!)).toBe("security");
    expect(byReq.get(fxA.requirementIds["VA-2"]!)).toBe("privacy");
    expect(byReq.get(fxA.requirementIds["VA-3"]!)).toBe("ai");
    expect(byReq.get(fxA.requirementIds["VA-4"]!)).toBe("resilience");
    expect(byReq.get(fxA.requirementIds["VA-5"]!)).toBe("nth_party");
    // the curated-only P2 tag maps to privacy through the extended table
    expect(byReq.get(fxA.requirementIds["VA-6"]!)).toBe("privacy");
  });

  it("GET /:id reports `domains` with all six keys, summing to the item count", async () => {
    const r = await asA("get", `/api/vendor-engagements/${id}`);
    expect(r.status).toBe(200);
    const q = r.body.questionnaire;
    expect(q.scoped).toBe(REQS.length);
    expect(Object.keys(q.domains)).toEqual([...ASSESSMENT_DOMAINS]);
    const sum = Object.values(q.domains as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(q.scoped);
    expect(q.domains).toEqual({ security: 1, privacy: 2, ai: 1, resilience: 1, nth_party: 1, compliance: 0 });
  });

  it("GET /:id/responses carries `domain` per item and the same `domains` counts", async () => {
    const r = await asA("get", `/api/vendor-engagements/${id}/responses`);
    expect(r.status).toBe(200);
    expect(r.body.counts.domains).toEqual({ security: 1, privacy: 2, ai: 1, resilience: 1, nth_party: 1, compliance: 0 });
    for (const item of r.body.items as Array<{ scope: { domain: string | null } }>) {
      expect(ASSESSMENT_DOMAINS as readonly string[]).toContain(item.scope.domain);
    }
  });

  it("the write path is JSON-only: a multipart POST /:id/scope is refused with 415 before any handler runs", async () => {
    const before = await domainRows(id);
    const r = await request(app)
      .post(`/api/vendor-engagements/${id}/scope`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .set("Content-Type", "multipart/form-data; boundary=x")
      .send("--x--");
    expect(r.status).toBe(415);
    expect(await domainRows(id)).toEqual(before);
  });

  it("the freeze is unaffected: after issue, re-resolve → 409 and integrity → match", async () => {
    const issued = await asA("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: "q2p2@example.com" });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    const again = await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("scope_frozen");

    let verdict: string | undefined;
    for (let i = 0; i < 20 && verdict !== "match"; i += 1) {
      const r = await asA("get", `/api/vendor-engagements/${id}/integrity`);
      expect(r.status).toBe(200);
      verdict = r.body.verdict as string;
      if (verdict !== "match") await new Promise((res) => setTimeout(res, 50));
    }
    expect(verdict).toBe("match");
    // and the stamps survived the issue
    for (const row of await domainRows(id)) expect(row.domain).not.toBeNull();
  });
});

describe("VA-Q2 P2 · a pre-Q2 engagement (stamped 1.0.0) is untouched — no backfill", () => {
  let id: string;

  it("re-resolving under the stamped 1.0.0 writes NULL on every item", async () => {
    id = await createEngagement(asA, fxA, "q2p2-legacy");
    // The stamp is written at creation with the current constant; a pre-Q2
    // engagement carries 1.0.0. Set it the way history did.
    await pool.query(`UPDATE vendor_engagements SET scope_rule_version = '1.0.0' WHERE id = $1`, [id]);
    const scoped = await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
    expect(scoped.body.scope_rule_version).toBe("1.0.0");
    const rows = await domainRows(id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.domain, row.requirement_id).toBeNull();
  });

  it("GET /:id reports `domains: null` — not six zeros", async () => {
    const r = await asA("get", `/api/vendor-engagements/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.questionnaire.domains).toBeNull();
    const resp = await asA("get", `/api/vendor-engagements/${id}/responses`);
    expect(resp.status).toBe(200);
    expect(resp.body.counts.domains).toBeNull();
    for (const item of resp.body.items as Array<{ scope: { domain: string | null } }>) {
      expect(item.scope.domain).toBeNull();
    }
  });
});

describe("VA-Q2 P2 · schema guarantees", () => {
  it("the CHECK is the closed vocabulary: a value outside it is refused (23514)", async () => {
    const id = await createEngagement(asA, fxA, "q2p2-check");
    await asA("post", `/api/vendor-engagements/${id}/scope`).send({});
    const rows = await domainRows(id);
    await expect(
      pool.query(`UPDATE vendor_engagement_scope_items SET domain = 'bogus' WHERE engagement_id = $1 AND requirement_id = $2`, [id, rows[0]!.requirement_id])
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("the CHECK list equals ASSESSMENT_DOMAINS, read from pg_constraint (lockstep)", async () => {
    const r = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'vendor_engagement_scope_items_domain_check'`
    );
    expect(r.rowCount).toBe(1);
    const literals = [...r.rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(literals).toEqual([...ASSESSMENT_DOMAINS]);
  });

  it("the migration is idempotent — applying it a second time is a no-op", async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM vendor_engagement_scope_items WHERE domain IS NOT NULL`);
    await pool.query(migrationSql());
    const after = await pool.query(`SELECT count(*)::int AS n FROM vendor_engagement_scope_items WHERE domain IS NOT NULL`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const cols = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'vendor_engagement_scope_items' AND column_name = 'domain'`
    );
    expect(cols.rows[0].n).toBe(1);
  });
});

describe("VA-Q2 P2 · tenant boundary", () => {
  let idA: string;

  it("org B cannot read org A's engagement (404) and org A's items are invisible to org B's resolver", async () => {
    idA = await createEngagement(asA, fxA, "q2p2-iso-a");
    await asA("post", `/api/vendor-engagements/${idA}/scope`).send({});
    expect((await asB("get", `/api/vendor-engagements/${idA}`)).status).toBe(404);
    expect((await asB("get", `/api/vendor-engagements/${idA}/responses`)).status).toBe(404);
    expect((await asB("post", `/api/vendor-engagements/${idA}/scope`).send({})).status).toBe(404);
    // org A's engagement is still exactly as org A left it
    for (const row of await domainRows(idA)) expect(row.domain).not.toBeNull();
  });

  it("under org B's RLS session the new column reads ZERO rows for org A (no new policy was needed)", async () => {
    const idB = await createEngagement(asB, fxB, "q2p2-iso-b");
    await asB("post", `/api/vendor-engagements/${idB}/scope`).send({});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const leak = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM vendor_engagement_scope_items WHERE engagement_id = $1 AND domain IS NOT NULL`,
        [idA]
      );
      expect(leak.rows[0]!.n).toBe(0);
      const own = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM vendor_engagement_scope_items WHERE engagement_id = $1 AND domain IS NOT NULL`,
        [idB]
      );
      expect(own.rows[0]!.n).toBe(REQS.length);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
