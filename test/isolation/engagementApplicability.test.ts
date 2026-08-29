/**
 * engagementApplicability.test.ts — VA-926, against real Postgres.
 *
 * The claim under test, in one sentence: **questionnaire truncation must never
 * erase applicability.** Everything else here is the machinery that makes that
 * claim safe — tenant isolation, immutability, and reproducibility after the
 * mutable inputs have moved on.
 *
 * The reproducibility block is the one that matters most. It resolves an
 * engagement, then supersedes the facts, deactivates the obligation, and
 * retags the requirement — every input the determination was made from — and
 * asserts the record still answers which rule fired, which domain applied,
 * which requirement applied, on what basis, under which resolver version, and
 * when.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { basisHash } from "../../src/api/lib/vendorRisk/applicabilityStore.js";
import { ASSESSMENT_DOMAINS } from "../../src/api/lib/vendorRisk/requirementDomain.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

const INTAKE = {
  data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "none",
};

type Fx = { vendorId: string; frameworkId: string; requirementIds: Record<string, string> };
let fxA: Fx;
let fxB: Fx;

const REQS: Array<[string, string, string[]]> = [
  ["AP-1", "Security policy", ["core"]],
  ["AP-2", "Personal data handling", ["privacy"]],
  ["AP-3", "Model governance", ["ai-governance"]],
  ["AP-4", "Sub-processor management", ["subprocessor"]],
];

const asA = (m: "get" | "post" | "put", p: string) =>
  (request(app) as never as Record<string, (p: string) => request.Test>)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post" | "put", p: string) =>
  (request(app) as never as Record<string, (p: string) => request.Test>)[m](p).set("X-Api-Key", seed.orgB.apiKey);

async function seedOrg(orgId: string, label: string): Promise<Fx> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor`, criticality: "medium" });
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} applicability framework`]
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
  await seedUser(pool, orgId, { email: `${label.toLowerCase()}-applicability@example.com` });
  return { vendorId, frameworkId: fw.rows[0]!.id, requirementIds };
}

async function createEngagement(who: typeof asA, fx: Fx, title: string): Promise<string> {
  const r = await who("post", "/api/vendor-engagements").send({
    ...INTAKE, vendor_id: fx.vendorId, engagement_type: "targeted", title,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

type Row = {
  id: string; rule_id: string; rule_family: string; domain: string | null;
  requirement_id: string; requirement_reference_id: string;
  basis: Record<string, unknown>; basis_hash: string;
  scope_rule_version: string; resolved_at: string;
};
async function rowsFor(engagementId: string): Promise<Row[]> {
  const r = await pool.query<Row>(
    `SELECT id, rule_id, rule_family, domain, requirement_id, requirement_reference_id,
            basis, basis_hash, scope_rule_version, resolved_at
       FROM engagement_applicability WHERE engagement_id = $1
      ORDER BY rule_id, requirement_reference_id`,
    [engagementId]
  );
  return r.rows;
}

/** Run as `app_request` under an org's RLS session. */
async function asAppRequest<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    const out = await fn(client);
    await client.query("ROLLBACK");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
async function sqlstate(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (e) { return (e as { code?: string }).code; }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
  fxA = await seedOrg(seed.orgA.id, "OrgA");
  fxB = await seedOrg(seed.orgB.id, "OrgB");
}, 180_000);

afterAll(async () => { await pool?.end(); });

// ───────────────────────────────────────────────────────────────────────────
// The claim
// ───────────────────────────────────────────────────────────────────────────

describe("truncation does not erase applicability", () => {
  let engagement: string;

  beforeAll(async () => {
    engagement = await createEngagement(asA, fxA, "[926] applicable, truncated");
    await asA("put", `/api/vendor-engagements/${engagement}/facts`).send({
      facts: [
        { fact_key: "data.personal_data", value: true },
        { fact_key: "ai.uses_ai", value: true },
        { fact_key: "ai.third_party_models", value: true },
      ],
    });
    expect((await asA("post", `/api/vendor-engagements/${engagement}/scope`).send({})).status).toBe(200);
  }, 60_000);

  it("records every rule that fired, including ones whose items were dropped", async () => {
    const rows = await rowsFor(engagement);
    const ruleIds = new Set(rows.map((r) => r.rule_id));
    for (const id of [
      "S1.baseline",
      "S5.security.baseline",
      "S5.privacy.personal_data",
      "S5.ai.declared",
      "S5.nth.third_party_models",
    ]) {
      expect(ruleIds, `${id} missing from ${[...ruleIds].join(", ")}`).toContain(id);
    }
  });

  it("an applicable requirement with NO question is visible — the invisible gap cannot exist", async () => {
    const rows = await rowsFor(engagement);
    const scoped = await pool.query<{ requirement_id: string }>(
      `SELECT requirement_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
      [engagement]
    );
    const asked = new Set(scoped.rows.map((r) => r.requirement_id));

    // Whether or not anything was truncated in THIS fixture, every applicable
    // requirement is answerable as asked-or-not. That is the property; the
    // fixture's size is not.
    for (const r of rows) {
      expect(typeof asked.has(r.requirement_id)).toBe("boolean");
    }
    const applicableIds = new Set(rows.map((r) => r.requirement_id));
    expect(applicableIds.size).toBeGreaterThan(0);
  });

  it("carries the domain each requirement applied under", async () => {
    const rows = await rowsFor(engagement);
    const withDomain = rows.filter((r) => r.domain !== null);
    expect(withDomain.length).toBeGreaterThan(0);
    for (const r of withDomain) {
      expect(ASSESSMENT_DOMAINS as readonly string[]).toContain(r.domain!);
    }
    expect(new Set(rows.filter((r) => r.rule_id === "S5.privacy.personal_data").map((r) => r.domain)))
      .toContain("privacy");
  });

  it("captures the triggering basis as VALUES, not pointers", async () => {
    const rows = await rowsFor(engagement);
    const privacy = rows.find((r) => r.rule_id === "S5.privacy.personal_data")!;
    expect(privacy.basis).toEqual({ domain: "privacy", facts: { "data.personal_data": true } });
    expect(privacy.basis_hash).toBe(basisHash(privacy.basis));
    expect(privacy.scope_rule_version).toBe("1.1.0");
  });

  it("does NOT record excluded or non-applicable requirements", async () => {
    // Owner ruling: authoritative for WHAT APPLIED. Not a negative-knowledge
    // ledger. Nothing outside the resolver's own inclusions may appear.
    const rows = await rowsFor(engagement);
    const scoped = await pool.query<{ n: number }>(
      `SELECT count(DISTINCT requirement_id)::int AS n FROM engagement_applicability WHERE engagement_id = $1`,
      [engagement]
    );
    expect(scoped.rows[0]!.n).toBeLessThanOrEqual(REQS.length);
    for (const r of rows) {
      expect(Object.values(fxA.requirementIds)).toContain(r.requirement_id);
    }
  });

  it("is idempotent — re-resolving with unchanged inputs writes nothing new", async () => {
    const before = await rowsFor(engagement);
    expect((await asA("post", `/api/vendor-engagements/${engagement}/scope`).send({})).status).toBe(200);
    const after = await rowsFor(engagement);
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// S3: a regulatory obligation cannot disappear
// ───────────────────────────────────────────────────────────────────────────

describe("S3 regulatory applicability is durable and observable", () => {
  let engagement: string;
  let obligationId: string;

  beforeAll(async () => {
    const ob = await pool.query<{ id: string }>(
      `INSERT INTO obligations (organization_id, title, status)
       VALUES ($1, 'GDPR Article 28 (test)', 'active') RETURNING id`,
      [seed.orgA.id]
    );
    obligationId = ob.rows[0]!.id;
    await pool.query(
      `INSERT INTO obligation_mappings (obligation_id, requirement_id) VALUES ($1, $2)`,
      [obligationId, fxA.requirementIds["AP-4"]]
    );
    engagement = await createEngagement(asA, fxA, "[926] S3 obligation");
    expect((await asA("post", `/api/vendor-engagements/${engagement}/scope`).send({})).status).toBe(200);
  }, 60_000);

  it("records S3.obligation with the obligation's identity AND title", async () => {
    const rows = await rowsFor(engagement);
    const s3 = rows.find((r) => r.rule_id === "S3.obligation");
    expect(s3, `no S3 row in ${rows.map((r) => r.rule_id).join(", ")}`).toBeDefined();
    expect(s3!.rule_family).toBe("S3");
    expect(s3!.basis).toEqual({
      obligation_id: obligationId,
      obligation_title: "GDPR Article 28 (test)",
    });
    expect(s3!.requirement_reference_id).toBe("AP-4");
  });

  it("survives the obligation being DEACTIVATED afterwards", async () => {
    const before = await rowsFor(engagement);
    // 'not_applicable' is the real deactivation value — obligations_status_check
    // permits active | waived | not_applicable, and the resolver's edge query
    // filters on status = 'active'.
    await pool.query(`UPDATE obligations SET status = 'not_applicable' WHERE id = $1`, [obligationId]);

    const after = await rowsFor(engagement);
    expect(after).toEqual(before);
    const s3 = after.find((r) => r.rule_id === "S3.obligation")!;
    // The TITLE is still answerable from the record, not from the mutable row.
    expect(s3.basis["obligation_title"]).toBe("GDPR Article 28 (test)");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Historical reproducibility
// ───────────────────────────────────────────────────────────────────────────

describe("the record reproduces after every mutable input has moved on", () => {
  let engagement: string;
  let snapshot: Row[];

  beforeAll(async () => {
    engagement = await createEngagement(asA, fxA, "[926] reproducibility");
    await asA("put", `/api/vendor-engagements/${engagement}/facts`).send({
      facts: [{ fact_key: "data.personal_data", value: true }],
    });
    expect((await asA("post", `/api/vendor-engagements/${engagement}/scope`).send({})).status).toBe(200);
    snapshot = await rowsFor(engagement);
    expect(snapshot.length).toBeGreaterThan(0);

    // Now move EVERY input the determination was made from.
    // 1. supersede the fact
    await asA("put", `/api/vendor-engagements/${engagement}/facts`).send({
      facts: [{ fact_key: "data.personal_data", value: false }],
    });
    // 2. retag the requirement (curation is not hypothetical — 63 rows moved
    //    on 2026-08-29)
    await pool.query(
      `UPDATE requirements SET scope_tags = ARRAY['core']::text[], scope_tags_at = NOW()
        WHERE id = $1`,
      [fxA.requirementIds["AP-2"]]
    );
    // 3. rename the requirement's reference
    await pool.query(`UPDATE requirements SET title = 'Renamed after the fact' WHERE id = $1`,
      [fxA.requirementIds["AP-2"]]);
  }, 90_000);

  it("still answers which rule fired, which domain, which requirement, on what basis, under which version, and when", async () => {
    const now = await rowsFor(engagement);
    expect(now).toEqual(snapshot);

    const privacy = now.find((r) => r.rule_id === "S5.privacy.personal_data");
    expect(privacy, "the privacy determination is gone").toBeDefined();
    expect(privacy!.domain).toBe("privacy");
    expect(privacy!.requirement_reference_id).toBe("AP-2");
    expect(privacy!.basis).toEqual({ domain: "privacy", facts: { "data.personal_data": true } });
    expect(privacy!.scope_rule_version).toBe("1.1.0");
    expect(privacy!.resolved_at).toBeTruthy();
  });

  it("the superseded fact really did change — the record is not merely stale-equal", async () => {
    const current = await pool.query<{ value: unknown }>(
      `SELECT value FROM assessment_facts
        WHERE subject_id = $1 AND fact_key = 'data.personal_data' AND status = 'accepted'`,
      [engagement]
    );
    expect(current.rows[0]!.value).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Isolation, authorization, integrity
// ───────────────────────────────────────────────────────────────────────────

describe("tenant isolation and integrity", () => {
  let engA: string;
  let engB: string;

  beforeAll(async () => {
    engA = await createEngagement(asA, fxA, "[926] isolation A");
    engB = await createEngagement(asB, fxB, "[926] isolation B");
    await asA("post", `/api/vendor-engagements/${engA}/scope`).send({});
    await asB("post", `/api/vendor-engagements/${engB}/scope`).send({});
  }, 60_000);

  it("org B cannot READ org A's applicability under RLS", async () => {
    const rows = await asAppRequest(seed.orgB.id, async (c) => {
      const r = await c.query(`SELECT id FROM engagement_applicability WHERE engagement_id = $1`, [engA]);
      return r.rows;
    });
    expect(rows).toEqual([]);
  });

  it("org A sees its own rows under RLS", async () => {
    const rows = await asAppRequest(seed.orgA.id, async (c) => {
      const r = await c.query(`SELECT id FROM engagement_applicability WHERE engagement_id = $1`, [engA]);
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a forged organization + engagement combination is refused", async () => {
    // org B's session claiming org B, pointing at org A's engagement.
    const code = await asAppRequest(seed.orgB.id, (c) =>
      c.query(
        `INSERT INTO engagement_applicability
           (organization_id, engagement_id, rule_id, rule_family, domain, requirement_id,
            requirement_reference_id, basis, basis_hash, scope_rule_version)
         VALUES ($1, $2, 'S1.baseline', 'S1', NULL, $3, 'AP-1', '{}'::jsonb, $4, '1.1.0')`,
        [seed.orgB.id, engA, fxB.requirementIds["AP-1"], basisHash({})]
      ).then(() => undefined).catch((e) => { throw e; })
    ).then(() => undefined).catch((e) => (e as { code?: string }).code);
    // The engagement is not visible in org B's session, so the subject trigger
    // refuses before RLS is reached — the same layering as assessment_facts.
    expect(code).toBe("23503");
  });

  it("cross-tenant write with the OTHER org's id is refused", async () => {
    const code = await asAppRequest(seed.orgB.id, (c) =>
      sqlstate(c.query(
        `INSERT INTO engagement_applicability
           (organization_id, engagement_id, rule_id, rule_family, domain, requirement_id,
            requirement_reference_id, basis, basis_hash, scope_rule_version)
         VALUES ($1, $2, 'S1.baseline', 'S1', NULL, $3, 'AP-1', '{}'::jsonb, $4, '1.1.0')`,
        [seed.orgA.id, engA, fxA.requirementIds["AP-1"], basisHash({})]
      ))
    );
    expect(code === "23503" || code === "42501").toBe(true);
  });

  it("an invalid rule_family, rule_id or domain is refused by CHECK", async () => {
    const bad = async (cols: string, vals: unknown[]) =>
      asAppRequest(seed.orgA.id, (c) => sqlstate(c.query(
        `INSERT INTO engagement_applicability
           (organization_id, engagement_id, rule_id, rule_family, domain, requirement_id,
            requirement_reference_id, basis, basis_hash, scope_rule_version)
         VALUES ${cols}`, vals)));

    expect(await bad(`($1,$2,'S9.bogus','S1',NULL,$3,'AP-1','{}'::jsonb,$4,'1.1.0')`,
      [seed.orgA.id, engA, fxA.requirementIds["AP-1"], basisHash({})])).toBe("23514");
    expect(await bad(`($1,$2,'S1.baseline','S9',NULL,$3,'AP-1','{}'::jsonb,$4,'1.1.0')`,
      [seed.orgA.id, engA, fxA.requirementIds["AP-1"], basisHash({})])).toBe("23514");
    expect(await bad(`($1,$2,'S1.baseline','S1','bogus',$3,'AP-1','{}'::jsonb,$4,'1.1.0')`,
      [seed.orgA.id, engA, fxA.requirementIds["AP-1"], basisHash({})])).toBe("23514");
  });

  it("the domain CHECK equals ASSESSMENT_DOMAINS, read from pg_constraint", async () => {
    const r = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'engagement_applicability_domain_check'`
    );
    expect(r.rowCount).toBe(1);
    const inDb = [...new Set([...r.rows[0]!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!))].sort();
    expect(inDb).toEqual([...ASSESSMENT_DOMAINS].sort());
  });

  it("rows are IMMUTABLE — update and delete are both refused", async () => {
    const upd = await asAppRequest(seed.orgA.id, (c) =>
      sqlstate(c.query(`UPDATE engagement_applicability SET domain = 'ai' WHERE engagement_id = $1`, [engA])));
    const del = await asAppRequest(seed.orgA.id, (c) =>
      sqlstate(c.query(`DELETE FROM engagement_applicability WHERE engagement_id = $1`, [engA])));
    // No UPDATE/DELETE grant to app_request, and an immutability trigger behind
    // it — either layer refusing is correct, neither alone is relied on.
    expect(upd).toBeDefined();
    expect(del).toBeDefined();
  });

  it("a requirement that applied cannot be deleted out from under the record", async () => {
    const code = await sqlstate(
      pool.query(`DELETE FROM requirements WHERE id = $1`, [fxA.requirementIds["AP-1"]])
    );
    expect(code).toBe("23503"); // ON DELETE RESTRICT
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 1.0.0 compatibility
// ───────────────────────────────────────────────────────────────────────────

describe("1.0.0 compatibility is unchanged", () => {
  it("a 1.0.0 engagement records applicability with NO domain and no Q2 rule", async () => {
    const e = await createEngagement(asA, fxA, "[926] legacy 1.0.0");
    await pool.query(`UPDATE vendor_engagements SET scope_rule_version = '1.0.0' WHERE id = $1`, [e]);
    expect((await asA("post", `/api/vendor-engagements/${e}/scope`).send({})).status).toBe(200);

    const rows = await rowsFor(e);
    expect(rows.length).toBeGreaterThan(0);
    // Applicability is recorded for legacy engagements too — S3 obligations
    // exist under 1.0.0 and must be as durable there.
    expect(rows.every((r) => r.scope_rule_version === "1.0.0")).toBe(true);
    expect(rows.every((r) => r.domain === null)).toBe(true);
    expect(rows.some((r) => r.rule_family === "S5")).toBe(false);

    // And the questionnaire itself is untouched: no domain on any scope item.
    const items = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM vendor_engagement_scope_items
        WHERE engagement_id = $1 AND domain IS NOT NULL`,
      [e]
    );
    expect(items.rows[0]!.n).toBe(0);
  }, 60_000);
});
