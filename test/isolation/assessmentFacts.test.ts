/**
 * assessmentFacts.test.ts — VA-Q2 P3: the canonical polymorphic fact store
 * (migration 20261063) driven through the real app over a throwaway DB.
 *
 * The §G.1 adversarial matrix of docs/design/VA-Q2-implementation-plan.md,
 * one named `it` per row (A1–A15 — the Case column verbatim), plus the schema
 * lockstep, RLS, grants, index and idempotency proofs §G lists for P3.
 *
 * Three integrity layers, each proven on its own:
 *   RLS       — A3, "RLS session for org B sees zero rows"
 *   trigger   — A2, A5, A6, A7, A12, A14
 *   resolver  — A1, A4, A6 (route), "reserved subject types are refused by the resolver"
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import {
  ALLOWED_SOURCE_ORIGIN_PAIRS,
  FACT_ORIGINS,
  FACT_SOURCES,
  FACT_SUBJECT_TYPES,
  RESERVED_FACT_SUBJECT_TYPES,
} from "../../src/api/lib/vendorRisk/factRegistry.js";
import { resolveFactSubject } from "../../src/api/lib/vendorRisk/factSubjects.js";
import { Q2_WRITABLE_SOURCES, factValueHash, writeFacts } from "../../src/api/lib/vendorRisk/factStore.js";
import { resolveFacts, factBool } from "../../src/api/lib/vendorRisk/factResolver.js";
import { generatePortalToken, hashPortalToken, PORTAL_SESSION_COOKIE } from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type M = "get" | "post" | "put";
const asA = (m: M, p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: M, p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

/** A quiet intake: tier 4 / low — S1 asks the `core` baseline only, so a privacy item appears ONLY through S5. */
const BENIGN_INTAKE = {
  engagement_type: "initial",
  data_sensitivity: "none", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "none",
};

type Fx = { vendorId: string; frameworkId: string; requirementIds: Record<string, string>; userId: string };
let fxA: Fx;
let fxB: Fx;

const REQS: Array<[string, string, string[]]> = [
  ["FS-1", "Security policy", ["core"]],
  ["FS-2", "Personal data handling", ["privacy"]],
  ["FS-3", "Model governance", ["ai-governance"]],
];

async function seedOrg(orgId: string, label: string): Promise<Fx> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor`, criticality: "medium" });
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
  const user = await seedUser(pool, orgId, { email: `${label.toLowerCase()}-reviewer@example.com` });
  return { vendorId, frameworkId: fw.rows[0]!.id, requirementIds, userId: user.id };
}

async function createEngagement(who: typeof asA, fx: Fx, title: string, intake: Record<string, unknown> = BENIGN_INTAKE): Promise<string> {
  const created = await who("post", "/api/vendor-engagements").send({ ...intake, vendor_id: fx.vendorId, title });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id as string;
}

async function countFor(subjectId: string): Promise<number> {
  const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts WHERE subject_id = $1`, [subjectId]);
  return r.rows[0]!.n;
}
async function countForOrg(orgId: string): Promise<number> {
  const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts WHERE organization_id = $1`, [orgId]);
  return r.rows[0]!.n;
}

type Row = { id: string; fact_key: string; value: unknown; source: string; origin: string; status: string; supersedes_id: string | null; verified_at: string | null; provenance: Record<string, unknown> };
async function rowsFor(subjectId: string, key?: string): Promise<Row[]> {
  const r = await pool.query<Row>(
    `SELECT id, fact_key, value, source, origin, status, supersedes_id, verified_at, provenance
       FROM assessment_facts WHERE subject_id = $1 AND ($2::text IS NULL OR fact_key = $2)
      ORDER BY created_at ASC, id ASC`,
    [subjectId, key ?? null]
  );
  return r.rows;
}

/** Run `fn` as app_request under an org's RLS session, inside a transaction that is always rolled back unless `commit`. */
async function asAppRequest<T>(orgId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const out = await fn(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const PROV = JSON.stringify({ actor: { kind: "user", id: null }, via: "test", at: new Date().toISOString(), evidence: null, model: null });
const INSERT = `INSERT INTO assessment_facts
  (organization_id, subject_type, subject_id, fact_key, value, value_hash, source, origin, provenance, observed_at, status)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, NOW(), $10)`;
const ins = (orgId: string, subjectType: string, subjectId: string, key: string, value: unknown, source: string, origin: string, status = "accepted") => [
  orgId, subjectType, subjectId, key, JSON.stringify(value), factValueHash(value), source, origin, PROV, status,
];

async function sqlstate(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

function migrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "../../db/migrations/20261063_assessment_facts.sql"), "utf8");
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  delete process.env.SECURELOGIC_SEAT_MODEL_ENABLED;
  pool = new Pool({ connectionString: url, ssl: false });
  fxA = await seedOrg(seed.orgA.id, "Q2P3-A");
  fxB = await seedOrg(seed.orgB.id, "Q2P3-B");
  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool.end();
});

// ─── A1–A3: cross-tenant subject substitution, one test per layer ───────────

describe("VA-Q2 P3 · §G.1 cross-tenant subject substitution", () => {
  let engB: string;

  it("cross-tenant subject substitution", async () => {
    // Runs FIRST in the file: the table is empty, so "zero rows for either org" is a whole-org count.
    engB = await createEngagement(asB, fxB, "q2p3-b-target");
    const put = await asA("put", `/api/vendor-engagements/${engB}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
    expect(put.status).toBe(404);
    expect(put.body.error).toBe("engagement_not_found");
    expect((await asA("get", `/api/vendor-engagements/${engB}/facts`)).status).toBe(404);
    expect(await countForOrg(seed.orgA.id)).toBe(0);
    expect(await countForOrg(seed.orgB.id)).toBe(0);
  });

  it("cross-tenant subject substitution (DB layer)", async () => {
    // app_request, org-A session, organization_id = A, subject = org-B engagement → the trigger cannot see it → 23503
    const code = await asAppRequest(seed.orgA.id, (c) =>
      c.query(INSERT, ins(seed.orgA.id, "vendor_engagement", engB, "data.personal_data", true, "intake", "intake"))
    ).then(() => undefined, (e: { code?: string }) => e.code);
    expect(code).toBe("23503");
    expect(await countFor(engB)).toBe(0);
  });

  it("cross-tenant subject substitution (RLS layer)", async () => {
    // org-A session writing organization_id = B. With the subject trigger live the
    // BEFORE trigger answers first (23503 — the org-B subject is invisible), so the
    // RLS layer is proven ON ITS OWN by disabling that trigger inside a rolled-back
    // owner transaction and switching to app_request: WITH CHECK refuses (42501).
    const withTrigger = await asAppRequest(seed.orgA.id, (c) =>
      c.query(INSERT, ins(seed.orgB.id, "vendor_engagement", engB, "data.personal_data", true, "intake", "intake"))
    ).then(() => undefined, (e: { code?: string }) => e.code);
    expect(withTrigger).toBe("23503");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`ALTER TABLE assessment_facts DISABLE TRIGGER assessment_facts_check_subject`);
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const code = await sqlstate(client.query(INSERT, ins(seed.orgB.id, "vendor_engagement", engB, "data.personal_data", true, "intake", "intake")));
      expect(code).toBe("42501");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(await countFor(engB)).toBe(0);
  });

  it("RLS session for org B sees zero rows of org A (and its own rows only)", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-rls");
    const put = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(await countFor(engA)).toBe(1);
    const seen = await asAppRequest(seed.orgB.id, async (c) => {
      const all = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts`);
      const a = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts WHERE subject_id = $1`, [engA]);
      return { all: all.rows[0]!.n, a: a.rows[0]!.n };
    });
    expect(seen.a).toBe(0);
    expect(seen.all).toBe(0);
    const own = await asAppRequest(seed.orgA.id, async (c) => (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts WHERE subject_id = $1`, [engA])).rows[0]!.n);
    expect(own).toBe(1);
  });
});

// ─── A4: unauthorized subject access ─────────────────────────────────────────

describe("VA-Q2 P3 · §G.1 unauthorized subject access", () => {
  it("unauthorized subject access", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-auth");
    const before = await countFor(engA);

    // portal cookie (an EXTERNAL principal) → 401 on both verbs
    const token = generatePortalToken();
    await pool.query(
      `INSERT INTO vendor_engagement_invites (organization_id, engagement_id, invite_token_hash, contact_email, expires_at)
       VALUES ($1, $2, $3, 'portal@example.com', NOW() + interval '1 day')`,
      [seed.orgA.id, engA, hashPortalToken(token)]
    );
    const session = await request(app).post("/api/vendor-portal/session").send({ token });
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    const cookie = (session.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
    expect((await request(app).get(`/api/vendor-engagements/${engA}/facts`).set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).put(`/api/vendor-engagements/${engA}/facts`).set("Cookie", cookie).send({ facts: [{ fact_key: "data.personal_data", value: true }] })).status).toBe(401);

    // contributor seat → 403 on PUT (denyContributor, seat model on for this call only)
    const rawKey = crypto.randomBytes(24).toString("hex");
    await pool.query(
      `INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status, bound_seat_type, bound_role)
       VALUES ($1, 'q2p3-contributor', $2, 'premium', 'active', 'contributor', 'analyst')`,
      [seed.orgA.id, crypto.createHash("sha256").update(rawKey).digest("hex")]
    );
    process.env.SECURELOGIC_SEAT_MODEL_ENABLED = "true";
    try {
      const r = await request(app).put(`/api/vendor-engagements/${engA}/facts`).set("X-Api-Key", rawKey).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("seat_not_permitted");
    } finally {
      delete process.env.SECURELOGIC_SEAT_MODEL_ENABLED;
    }

    // a member of org B → 404 on org A's id (never 403: no existence oracle)
    const b = await asB("get", `/api/vendor-engagements/${engA}/facts`);
    expect(b.status).toBe(404);
    expect(b.body).toEqual({ error: "engagement_not_found" });

    expect(await countFor(engA)).toBe(before);
  });
});

// ─── A5: invalid / reserved subject type ─────────────────────────────────────

describe("VA-Q2 P3 · §G.1 invalid subject type", () => {
  it("invalid subject type", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-type");
    // RESERVED and bogus types → the CHECK (23514), as app_request
    for (const t of [...RESERVED_FACT_SUBJECT_TYPES, "bogus"]) {
      const code = await asAppRequest(seed.orgA.id, (c) => c.query(INSERT, ins(seed.orgA.id, t, engA, "data.personal_data", true, "intake", "intake")))
        .then(() => undefined, (e: { code?: string }) => e.code);
      expect(code, t).toBe("23514");
    }
    // The trigger's ELSE arm, behind the CHECK: drop the CHECK inside a rolled-back tx and the arm still refuses.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`ALTER TABLE assessment_facts DROP CONSTRAINT assessment_facts_subject_type_check`);
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      let msg = "";
      try {
        await client.query(INSERT, ins(seed.orgA.id, "vendor", engA, "data.personal_data", true, "intake", "intake"));
      } catch (e) {
        msg = String((e as Error).message);
      }
      expect(msg).toMatch(/has no resolver arm/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // body subject_type on PUT is ignored: the row reads back as vendor_engagement / the path id
    const put = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({
      facts: [{ fact_key: "data.personal_data", value: true, subject_type: "vendor", subject_id: fxA.vendorId, status: "proposed", verified_at: null }],
      subject_type: "vendor",
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const rows = await pool.query<{ subject_type: string; subject_id: string; status: string; verified_at: string | null }>(
      `SELECT subject_type, subject_id, status, verified_at FROM assessment_facts WHERE subject_id = $1`, [engA]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ subject_type: "vendor_engagement", subject_id: engA, status: "accepted" });
    expect(rows.rows[0]!.verified_at).not.toBeNull();
    expect(await countFor(fxA.vendorId)).toBe(0);
  });

  it("reserved subject types are refused by the resolver (reader + writer) even for a row that would load", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-reserved");
    for (const t of [...RESERVED_FACT_SUBJECT_TYPES, "bogus", "", null, undefined]) {
      const subject = await withTenant(seed.orgA.id, () => resolveFactSubject(pool, seed.orgA.id, t, engA));
      expect(subject, String(t)).toBeNull();
    }
    const ok = await resolveFactSubject(pool, seed.orgA.id, "vendor_engagement", engA);
    expect(ok?.kind).toBe("vendor_engagement");
    expect(ok?.organization_id).toBe(seed.orgA.id);
    // org mismatch → null even though the row exists
    expect(await resolveFactSubject(pool, seed.orgB.id, "vendor_engagement", engA)).toBeNull();
  });

  it("the CHECK list equals FACT_SUBJECT_TYPES, and the source/origin CHECKs equal the registry (lockstep, from pg_constraint)", async () => {
    const def = async (name: string) => (await pool.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [name])).rows[0]!.def;
    const lits = (d: string) => [...d.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(lits(await def("assessment_facts_subject_type_check"))).toEqual([...FACT_SUBJECT_TYPES]);
    expect(lits(await def("assessment_facts_source_check")).sort()).toEqual([...FACT_SOURCES].sort());
    expect(lits(await def("assessment_facts_origin_check")).sort()).toEqual([...FACT_ORIGINS].sort());
  });

  it("the (source, origin) pair CHECK is exactly ALLOWED_SOURCE_ORIGIN_PAIRS (every combination probed)", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-pairs");
    for (const source of FACT_SOURCES) {
      for (const origin of FACT_ORIGINS) {
        const allowed = ALLOWED_SOURCE_ORIGIN_PAIRS[source].includes(origin);
        // policy.frameworks_active allows `derived`; born `proposed` so the AI insert rule does not interfere
        const code = await asAppRequest(seed.orgA.id, (c) => c.query(INSERT, ins(seed.orgA.id, "vendor_engagement", engA, "policy.frameworks_active", ["x"], source, origin, "proposed")))
          .then(() => undefined, (e: { code?: string }) => e.code);
        if (allowed) expect(code, `${source}/${origin} should be allowed`).toBeUndefined();
        else expect(code, `${source}/${origin} should be refused`).toBe("23514");
      }
    }
  });
});

// ─── A6 / A7: nonexistent subject, mismatched org/subject ────────────────────

describe("VA-Q2 P3 · §G.1 subject existence and ownership", () => {
  it("nonexistent subject", async () => {
    const ghost = crypto.randomUUID();
    const put = await asA("put", `/api/vendor-engagements/${ghost}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
    expect(put.status).toBe(404);
    expect((await asA("get", `/api/vendor-engagements/${ghost}/facts`)).status).toBe(404);
    expect((await asA("get", `/api/vendor-engagements/not-a-uuid/facts`)).status).toBe(404);
    const code = await asAppRequest(seed.orgA.id, (c) => c.query(INSERT, ins(seed.orgA.id, "vendor_engagement", ghost, "data.personal_data", true, "intake", "intake")))
      .then(() => undefined, (e: { code?: string }) => e.code);
    expect(code).toBe("23503");
    expect(await countFor(ghost)).toBe(0);
  });

  it("mismatched org/subject", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-mismatch");
    const engB = await createEngagement(asB, fxB, "q2p3-b-mismatch");
    await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
    const [row] = await rowsFor(engA);
    // UPDATE arm of the subject trigger: re-point an org-A row at org B's engagement under org A's session
    const c1 = await asAppRequest(seed.orgA.id, (c) => c.query(`UPDATE assessment_facts SET subject_id = $1 WHERE id = $2`, [engB, row!.id]))
      .then(() => undefined, (e: { code?: string }) => e.code);
    expect(c1).toBe("23503");
    // and as the OWNER (no RLS): move the org while the subject stays A's → the trigger still refuses
    const c2 = await sqlstate(pool.query(`UPDATE assessment_facts SET organization_id = $1 WHERE id = $2`, [seed.orgB.id, row!.id]));
    expect(c2).toBe("23503");
    const after = await rowsFor(engA);
    expect(after.map((r) => r.id)).toEqual([row!.id]);
  });
});

// ─── A8: malformed fact type / value ─────────────────────────────────────────

describe("VA-Q2 P3 · §G.1 malformed fact type/value", () => {
  it("malformed fact type/value", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-malformed");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ fact_key: "data.does_not_exist", value: true }, "fact_key"],
      [{ fact_key: "core.data_volume", value: "huge" }, "value"],
      // a well-formed core.* value is still refused: the inherent-risk columns are the store of record
      [{ fact_key: "core.data_volume", value: "moderate" }, "fact_key"],
      [{ fact_key: "ai.uses_ai", value: "yes" }, "value"],
      [{ fact_key: "DATA.personal_data", value: true }, "fact_key"],
      [{ fact_key: "data..personal_data", value: true }, "fact_key"],
      [{ fact_key: "data.personal_data; DROP TABLE assessment_facts;--", value: true }, "fact_key"],
      [{ fact_key: "data.personal_data", value: true, source: "vendor_response" }, "source"],
      [{ fact_key: "data.personal_data", value: true, source: "ai_extraction" }, "source"],
      [{ fact_key: "data.personal_data", value: true, source: "system_derived" }, "source"],
      [{ fact_key: "data.personal_data", value: true, origin: "vendor_answer" }, "origin"],
      [{ fact_key: "policy.frameworks_active", value: ["soc2"] }, "origin"],
      [{ fact_key: "data.personal_data", value: true, observed_at: "2999-01-01T00:00:00Z" }, "value"],
    ];
    for (const [fact, field] of cases) {
      const r = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [fact] });
      expect(r.status, JSON.stringify(fact)).toBe(400);
      expect(r.body.error).toBe("invalid_facts");
      const fields = (r.body.details as Array<{ errors: Array<{ field: string }> }>).flatMap((d) => d.errors.map((e) => e.field));
      expect(fields, JSON.stringify(fact)).toContain(field);
    }
    // a bad batch writes nothing, even when one entry is valid
    const mixed = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }, { fact_key: "nope", value: 1 }] });
    expect(mixed.status).toBe(400);
    expect(await countFor(engA)).toBe(0);
    // shape / limits
    expect((await asA("put", `/api/vendor-engagements/${engA}/facts`).send({})).status).toBe(400);
    expect((await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [] })).status).toBe(400);
    const big = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.jurisdictions", value: ["A".repeat(2 * 1024 * 1024)] }] });
    expect([400, 413]).toContain(big.status);
    expect(await countFor(engA)).toBe(0);
    // the DB checks shape too: a hash that is not sha256 hex, a key outside the shape, confidence > 1
    const badHash = ins(seed.orgA.id, "vendor_engagement", engA, "data.personal_data", true, "intake", "intake");
    badHash[5] = "nothex";
    expect(await sqlstate(asAppRequest(seed.orgA.id, (c) => c.query(INSERT, badHash)))).toBe("23514");
    const badKey = await asAppRequest(seed.orgA.id, (c) => c.query(INSERT, ins(seed.orgA.id, "vendor_engagement", engA, "Data.X", true, "intake", "intake"))).then(() => undefined, (e: { code?: string }) => e.code);
    expect(badKey).toBe("23514");
  });
});

// ─── A9: duplicate ingestion ─────────────────────────────────────────────────

describe("VA-Q2 P3 · §G.1 duplicate fact ingestion", () => {
  it("duplicate fact ingestion", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-dup");
    const body = { facts: [{ fact_key: "data.personal_data", value: true }, { fact_key: "data.categories", value: ["contact", "identifiers"] }] };
    const first = await asA("put", `/api/vendor-engagements/${engA}/facts`).send(body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ inserted: 2, unchanged: 0, superseded: 0 });
    const second = await asA("put", `/api/vendor-engagements/${engA}/facts`).send(body);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ inserted: 0, unchanged: 2, superseded: 0 });
    expect(await countFor(engA)).toBe(2);
    // canonical hash: key order inside a value does not matter (object values are hashed canonically)
    expect(factValueHash({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(factValueHash({ a: [2, { c: 2, d: 1 }], b: 1 }));

    // same mirror twice: two scope resolves, identical row count
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(200);
    const afterFirst = await countFor(engA);
    expect(afterFirst).toBe(2 + 13);
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(200);
    expect(await countFor(engA)).toBe(afterFirst);
    expect((await rowsFor(engA)).every((r) => r.status === "accepted")).toBe(true);

    // concurrent double PUT (two clients): one row, no superseded churn
    const body2 = { facts: [{ fact_key: "data.cross_border", value: true }] };
    const [x, y] = await Promise.all([
      asA("put", `/api/vendor-engagements/${engA}/facts`).send(body2),
      asA("put", `/api/vendor-engagements/${engA}/facts`).send(body2),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    const cb = await rowsFor(engA, "data.cross_border");
    expect(cb).toHaveLength(1);
    expect(cb[0]!.status).toBe("accepted");
  });
});

// ─── A10: conflicting provenance ─────────────────────────────────────────────

describe("VA-Q2 P3 · §G.1 conflicting provenance", () => {
  it("conflicting provenance", async () => {
    // vendor profile says AI; an AI-system dependency says AI; intake says NO — three rows, three provenances, intake wins
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Q2P3 conflicting vendor", criticality: "medium" });
    await pool.query(`UPDATE vendors SET template_metadata = '{"flags":{"processes_ai_inference":true,"processes_pii":true}}'::jsonb WHERE id = $1`, [vendorId]);
    const ai = await pool.query<{ id: string }>(`INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'Q2P3 assistant') RETURNING id`, [seed.orgA.id]);
    const dep = await pool.query<{ id: string }>(
      `INSERT INTO ai_system_vendor_dependencies (organization_id, ai_system_id, vendor_id, dependency_role) VALUES ($1, $2, $3, 'model_provider') RETURNING id`,
      [seed.orgA.id, ai.rows[0]!.id, vendorId]
    );
    // org B has a dependency on ITS vendor with the same role — it must never leak into A's facts
    const aiB = await pool.query<{ id: string }>(`INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'Q2P3 B assistant') RETURNING id`, [seed.orgB.id]);
    await pool.query(`INSERT INTO ai_system_vendor_dependencies (organization_id, ai_system_id, vendor_id, dependency_role) VALUES ($1, $2, $3, 'training_data')`, [seed.orgB.id, aiB.rows[0]!.id, fxB.vendorId]);

    const engA = await createEngagement(asA, { ...fxA, vendorId }, "q2p3-a-conflict");
    expect((await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "ai.uses_ai", value: false }] })).status).toBe(200);
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(200);

    const rows = await rowsFor(engA, "ai.uses_ai");
    expect(rows.map((r) => [r.source, r.origin, r.value]).sort()).toEqual([
      ["intake", "intake", false],
      ["system_derived", "ai_system_dependency", true],
      ["system_derived", "vendor_profile", true],
    ]);
    const depRow = rows.find((r) => r.origin === "ai_system_dependency")!;
    expect(depRow.provenance["evidence"]).toEqual({ table: "ai_system_vendor_dependencies", id: dep.rows[0]!.id });
    expect(depRow.verified_at).toBeNull();
    // ai.third_party_models from the model_provider role; trains_on_customer_data NOT inferred
    expect((await rowsFor(engA, "ai.third_party_models")).map((r) => r.origin)).toEqual(["ai_system_dependency"]);
    expect(await rowsFor(engA, "ai.trains_on_customer_data")).toEqual([]);
    // data.personal_data from the pii flag (vendor_profile), no verification
    const pd = await rowsFor(engA, "data.personal_data");
    expect(pd.map((r) => [r.source, r.origin, r.value, r.verified_at])).toEqual([["system_derived", "vendor_profile", true, null]]);

    const g = await asA("get", `/api/vendor-engagements/${engA}/facts`);
    expect(g.status).toBe(200);
    const shown = (g.body.facts as Row[]).filter((r) => r.fact_key === "ai.uses_ai");
    expect(shown).toHaveLength(3);
    for (const r of shown) expect(typeof r.source === "string" && typeof r.origin === "string" && r.provenance).toBeTruthy();
    expect(g.body.resolved["ai.uses_ai"]).toMatchObject({ value: false, origin: "intake", source: "intake" });
    expect(g.body.resolved["ai.uses_ai"].contributing_origins).toEqual(["intake", "ai_system_dependency", "vendor_profile"]);
    // B's training_data dependency produced nothing anywhere for A (and nothing for A's vendor)
    expect((await pool.query(`SELECT 1 FROM assessment_facts WHERE organization_id = $1 AND fact_key = 'ai.uses_ai' AND origin = 'ai_system_dependency' AND subject_id <> $2`, [seed.orgA.id, engA])).rowCount).toBe(0);
  });
});

// ─── A11 / A12 / A13: authority rules ────────────────────────────────────────

describe("VA-Q2 P3 · §G.1 authority rules (Q0 rulings written as tests)", () => {
  it("vendor attempt to narrow issued scope", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-issued");
    expect((await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] })).status).toBe(200);
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(200);
    const issued = await asA("post", `/api/vendor-engagements/${engA}/issue`).send({ contact_email: "q2p3@example.com" });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    // the hash is stamped after issue; wait for it the way the P2 suite does
    let hashBefore: string | null = null;
    for (let i = 0; i < 40 && !hashBefore; i += 1) {
      hashBefore = (await pool.query<{ h: string | null }>(`SELECT question_set_hash AS h FROM vendor_engagements WHERE id = $1`, [engA])).rows[0]!.h;
      if (!hashBefore) await new Promise((res) => setTimeout(res, 50));
    }
    expect(hashBefore).toBeTruthy();

    // A simulated Q3 vendor_response row (there is NO Q2 writer for it — asserted below) says "no personal data"
    await pool.query(INSERT, ins(seed.orgA.id, "vendor_engagement", engA, "data.personal_data", false, "vendor_response", "vendor_answer"));
    const rows = await pool.query<{ fact_key: string; value: unknown; source: string; origin: string; status: string; observed_at: Date }>(
      `SELECT fact_key, value, source, origin, status, observed_at FROM assessment_facts WHERE subject_id = $1 AND status = 'accepted'`, [engA]
    );
    const resolved = resolveFacts(rows.rows.map((r) => ({ ...r, subject: { subject_type: "vendor_engagement" as const, subject_id: engA } })));
    expect(factBool(resolved, "data.personal_data")).toBe(true);
    expect(resolved["data.personal_data"]?.origin).toBe("intake");
    expect(resolved["data.personal_data"]?.contributing_origins).toContain("vendor_answer");
    // vendor rows can never carry verified_at
    const v = await sqlstate(pool.query(`UPDATE assessment_facts SET verified_at = NOW() WHERE subject_id = $1 AND source = 'vendor_response'`, [engA]));
    expect(v).toBe("23514");

    // Q2's writers are refused on an issued subject; the snapshot does not move
    const put = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: false }] });
    expect(put.status).toBe(409);
    expect(put.body.error).toBe("scope_frozen");
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(409);
    const subject = await resolveFactSubject(pool, seed.orgA.id, "vendor_engagement", engA);
    await expect(writeFacts(pool, seed.orgA.id, subject!, [{ fact_key: "data.personal_data", value: true, source: "vendor_response", origin: "vendor_answer", observed_at: new Date(), provenance: { actor: { kind: "vendor_participant", id: null }, via: "test", at: new Date().toISOString() } }]))
      .rejects.toThrow(/has no writer in this package/);
    expect(Q2_WRITABLE_SOURCES).not.toContain("vendor_response");
    expect(Q2_WRITABLE_SOURCES).not.toContain("ai_extraction");
    const hashAfter = (await pool.query<{ h: string }>(`SELECT question_set_hash AS h FROM vendor_engagements WHERE id = $1`, [engA])).rows[0]!.h;
    expect(hashAfter).toBe(hashBefore);
    let verdict: string | undefined;
    for (let i = 0; i < 20 && verdict !== "match"; i += 1) {
      const r = await asA("get", `/api/vendor-engagements/${engA}/integrity`);
      verdict = r.body.verdict as string;
      if (verdict !== "match") await new Promise((res) => setTimeout(res, 50));
    }
    expect(verdict).toBe("match");
  });

  it("AI-originated fact attempting authoritative mutation", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-ai");
    const base = ins(seed.orgA.id, "vendor_engagement", engA, "policy.frameworks_active", ["soc2"], "ai_extraction", "derived");
    // INSERT accepted → refused by the trigger
    expect(await sqlstate(asAppRequest(seed.orgA.id, (c) => c.query(INSERT, base)))).toBe("23514");
    // INSERT proposed → stored, and ignored by the resolver
    await asAppRequest(seed.orgA.id, (c) => c.query(INSERT, [...base.slice(0, 9), "proposed"]), true);
    const rows = await pool.query<{ id: string; fact_key: string; value: unknown; source: string; origin: string; status: string }>(
      `SELECT id, fact_key, value, source, origin, status FROM assessment_facts WHERE subject_id = $1`, [engA]
    );
    expect(rows.rows.map((r) => r.status)).toEqual(["proposed"]);
    expect(resolveFacts(rows.rows)["policy.frameworks_active"]).toBeUndefined();
    const id = rows.rows[0]!.id;
    // UPDATE proposed → accepted outside the governed accept (no accepted_by) → refused
    expect(await sqlstate(asAppRequest(seed.orgA.id, (c) => c.query(`UPDATE assessment_facts SET status = 'accepted' WHERE id = $1`, [id])))).toBe("23514");
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [id]))).toBe("23514");
    // a model can never verify
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET verified_at = NOW() WHERE id = $1`, [id]))).toBe("23514");
    // the value cannot be rewritten in place
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET value = '["iso27001"]'::jsonb, value_hash = $2 WHERE id = $1`, [id, factValueHash(["iso27001"])]))).toBe("23514");
    // the governed human accept: a named human, now → accepted, and only now does the resolver read it
    await asAppRequest(seed.orgA.id, (c) => c.query(`UPDATE assessment_facts SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = $2 WHERE id = $1`, [id, fxA.userId]), true);
    const after = await pool.query<{ fact_key: string; value: unknown; source: string; origin: string; status: string }>(`SELECT fact_key, value, source, origin, status FROM assessment_facts WHERE id = $1`, [id]);
    expect(after.rows[0]!.status).toBe("accepted");
    expect(resolveFacts(after.rows)["policy.frameworks_active"]?.value).toEqual(["soc2"]);
    expect(resolveFacts(after.rows, { verifiedOnly: true })["policy.frameworks_active"]).toBeUndefined();
    // terminal: accepted → proposed / rejected are illegal
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET status = 'proposed' WHERE id = $1`, [id]))).toBe("23514");
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET status = 'rejected' WHERE id = $1`, [id]))).toBe("23514");
  });

  it("historical / reassessment behaviour", async () => {
    // P3 proves the row-level history semantics; the E1/E2/E3 child-engagement composition proof is P4's file.
    const engA = await createEngagement(asA, fxA, "q2p3-a-history");
    const put = (v: unknown) => asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: v }] });
    expect((await put(true)).body).toMatchObject({ inserted: 1, superseded: 0 });
    expect((await put(false)).body).toMatchObject({ inserted: 1, superseded: 1 });
    expect((await put(true)).body).toMatchObject({ inserted: 1, superseded: 1 }); // A→B→A is possible: the key is partial
    const chain = await rowsFor(engA, "data.personal_data");
    expect(chain.map((r) => [r.value, r.status])).toEqual([[true, "superseded"], [false, "superseded"], [true, "accepted"]]);
    expect(chain[1]!.supersedes_id).toBe(chain[0]!.id);
    expect(chain[2]!.supersedes_id).toBe(chain[1]!.id);
    // the superseded row is immutable history
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET status = 'accepted' WHERE id = $1`, [chain[0]!.id]))).toBe("23514");
    expect(await sqlstate(pool.query(`UPDATE assessment_facts SET value = 'false'::jsonb WHERE id = $1`, [chain[0]!.id]))).toBe("23514");
    // GET shows the whole history with status, and the resolved set reads the accepted row only
    const g = await asA("get", `/api/vendor-engagements/${engA}/facts`);
    expect((g.body.facts as Row[]).filter((r) => r.fact_key === "data.personal_data").map((r) => r.status)).toEqual(["superseded", "superseded", "accepted"]);
    expect(g.body.resolved["data.personal_data"]).toMatchObject({ value: true, origin: "intake" });
    // the reassessment view: with a (simulated Q3) vendor answer widening a list, verifiedOnly is narrower
    await pool.query(INSERT, ins(seed.orgA.id, "vendor_engagement", engA, "data.categories", ["contact"], "vendor_response", "vendor_answer"));
    expect((await put(true)).status).toBe(200); // no-op, still mutable
    const rows = await pool.query<{ fact_key: string; value: unknown; source: string; origin: string; status: string }>(`SELECT fact_key, value, source, origin, status FROM assessment_facts WHERE subject_id = $1 AND status = 'accepted'`, [engA]);
    expect(resolveFacts(rows.rows)["data.categories"]?.value).toEqual(["contact"]);
    expect(resolveFacts(rows.rows, { verifiedOnly: true })["data.categories"]).toBeUndefined();
    // a vendor row cannot be the supersedes target of an intake row and vice versa — same key only
    const vendorRow = (await rowsFor(engA, "data.categories"))[0]!;
    const code = await sqlstate(pool.query(
      `INSERT INTO assessment_facts (organization_id, subject_type, subject_id, fact_key, value, value_hash, source, origin, provenance, observed_at, supersedes_id)
       VALUES ($1,'vendor_engagement',$2,'data.personal_data','false'::jsonb,$3,'intake','intake',$4::jsonb,NOW(),$5)`,
      [seed.orgA.id, engA, factValueHash(false), PROV, vendorRow.id]
    ));
    expect(code).toBe("23503");
  });
});

// ─── A14 / A15 ───────────────────────────────────────────────────────────────

describe("VA-Q2 P3 · §G.1 identifier manipulation and value leakage", () => {
  it("identifier manipulation (Q1 class, carried)", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-ident");
    const engA2 = await createEngagement(asA, fxA, "q2p3-a-ident-2");
    const engB = await createEngagement(asB, fxB, "q2p3-b-ident");
    // subject_id in the body ≠ path id → ignored: the row lands on the PATH subject
    const put = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ subject_id: engA2, facts: [{ fact_key: "data.personal_data", value: true, subject_id: engB }] });
    expect(put.status).toBe(200);
    expect(await countFor(engA)).toBe(1);
    expect(await countFor(engA2)).toBe(0);
    expect(await countFor(engB)).toBe(0);
    const [row] = await rowsFor(engA);
    // supersedes_id pointing at another subject (same org) → 23503
    const other = await sqlstate(asAppRequest(seed.orgA.id, (c) => c.query(
      `INSERT INTO assessment_facts (organization_id, subject_type, subject_id, fact_key, value, value_hash, source, origin, provenance, observed_at, supersedes_id)
       VALUES ($1,'vendor_engagement',$2,'data.personal_data','false'::jsonb,$3,'intake','intake',$4::jsonb,NOW(),$5)`,
      [seed.orgA.id, engA2, factValueHash(false), PROV, row!.id]
    )));
    expect(other).toBe("23503");
    // supersedes_id pointing at another ORG's row → under RLS not found → 23503, and as owner → 23503 (org mismatch)
    await asB("put", `/api/vendor-engagements/${engB}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
    const [rowB] = await rowsFor(engB);
    const cross = await sqlstate(asAppRequest(seed.orgA.id, (c) => c.query(
      `INSERT INTO assessment_facts (organization_id, subject_type, subject_id, fact_key, value, value_hash, source, origin, provenance, observed_at, supersedes_id)
       VALUES ($1,'vendor_engagement',$2,'data.personal_data','false'::jsonb,$3,'intake','intake',$4::jsonb,NOW(),$5)`,
      [seed.orgA.id, engA, factValueHash(false), PROV, rowB!.id]
    )));
    expect(cross).toBe("23503");
    expect(await countFor(engA)).toBe(1);
    expect(await countFor(engA2)).toBe(0);
  });

  it("fact values never leak", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-leak");
    // a distinctive, registry-valid value nothing else in this suite uses
    const marker = "QX";
    const put = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.jurisdictions", value: [marker] }, { fact_key: "data.personal_data", value: true }] });
    expect(put.status).toBe(200);
    // audit row: keys only
    let audit: { payload: Record<string, unknown> } | undefined;
    for (let i = 0; i < 40 && !audit; i += 1) {
      const r = await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM security_audit_log WHERE event_type = 'vendor_engagement.facts_declared' AND resource_id = $1 ORDER BY created_at DESC LIMIT 1`, [engA]
      );
      audit = r.rows[0];
      if (!audit) await new Promise((res) => setTimeout(res, 50));
    }
    expect(audit).toBeTruthy();
    expect(audit!.payload["keys"]).toEqual(["data.jurisdictions", "data.personal_data"]);
    expect(JSON.stringify(audit!.payload)).not.toContain(marker);
    // error bodies echo the field and the rule, never the submitted value
    const bad = await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.jurisdictions", value: ["SECRETVALUE"] }] });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain("SECRETVALUE");
    // S5 reasons text on the scope items carries the static rationale, never the value
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(200);
    const reasons = await pool.query<{ reasons: unknown }>(`SELECT reasons FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [engA]);
    expect(reasons.rowCount).toBeGreaterThan(0);
    expect(JSON.stringify(reasons.rows)).not.toContain(marker);
  });
});

// ─── The reason the store exists: the scope route reads it ───────────────────

describe("VA-Q2 P3 · the scope resolver reads accepted facts (S5 privacy reachable)", () => {
  it("a declared data.personal_data=true activates S5.privacy.personal_data on a benign intake; mirrors carry provenance + verification", async () => {
    const engA = await createEngagement(asA, fxA, "q2p3-a-s5");
    const before = await asA("post", `/api/vendor-engagements/${engA}/scope`).send({});
    expect(before.status).toBe(200);
    const itemsBefore = await pool.query<{ requirement_id: string; reasons: Array<{ rule_id: string }> }>(`SELECT requirement_id, reasons FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [engA]);
    expect(itemsBefore.rows.map((r) => r.requirement_id)).not.toContain(fxA.requirementIds["FS-2"]);
    // the 13-input mirror: intake/intake, verified, provenance names the engagement
    const core = (await rowsFor(engA)).filter((r) => r.fact_key.startsWith("core."));
    expect(core).toHaveLength(13);
    for (const r of core) {
      expect([r.source, r.origin, r.status]).toEqual(["intake", "intake", "accepted"]);
      expect(r.verified_at).not.toBeNull();
      expect(r.provenance).toMatchObject({ actor: { kind: "system" }, via: "scope_resolve:mirror", evidence: { table: "vendor_engagements", id: engA } });
    }

    expect((await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true, source: "internal_user" }] })).status).toBe(200);
    const after = await asA("post", `/api/vendor-engagements/${engA}/scope`).send({});
    expect(after.status).toBe(200);
    const items = await pool.query<{ requirement_id: string; domain: string | null; reasons: Array<{ rule_id: string }> }>(`SELECT requirement_id, domain, reasons FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [engA]);
    const privacy = items.rows.find((r) => r.requirement_id === fxA.requirementIds["FS-2"]);
    expect(privacy).toBeTruthy();
    expect(privacy!.domain).toBe("privacy");
    expect(privacy!.reasons.map((x) => x.rule_id)).toContain("S5.privacy.personal_data");
    // an internal_user declaration is verified and distinguishable from intake
    const pd = await rowsFor(engA, "data.personal_data");
    expect(pd.map((r) => [r.source, r.origin, r.status])).toEqual([["internal_user", "intake", "accepted"]]);
    expect(pd[0]!.verified_at).not.toBeNull();
    // a changed inherent input supersedes its mirror row (history kept)
    await pool.query(`UPDATE vendor_engagements SET data_sensitivity = 'restricted', updated_at = NOW() WHERE id = $1`, [engA]);
    expect((await asA("post", `/api/vendor-engagements/${engA}/scope`).send({})).status).toBe(200);
    const ds = await rowsFor(engA, "core.data_sensitivity");
    expect(ds.map((r) => [r.value, r.status])).toEqual([["none", "superseded"], ["restricted", "accepted"]]);
    expect(ds[1]!.supersedes_id).toBe(ds[0]!.id);
  });
});

// ─── Schema guarantees ───────────────────────────────────────────────────────

describe("VA-Q2 P3 · schema guarantees", () => {
  it("app_request has SELECT, INSERT, UPDATE and NO DELETE; RLS is enabled with the tenant policy; no DELETE/TRUNCATE trigger exists", async () => {
    const g = await pool.query<{ p: string }>(`SELECT privilege_type AS p FROM information_schema.role_table_grants WHERE table_name = 'assessment_facts' AND grantee = 'app_request' ORDER BY 1`);
    expect(g.rows.map((r) => r.p)).toEqual(["INSERT", "SELECT", "UPDATE"]);
    const rls = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'assessment_facts'`);
    expect(rls.rows[0]!.relrowsecurity).toBe(true);
    expect(rls.rows[0]!.relforcerowsecurity).toBe(false); // platform standard: NOT FORCE (20260619/20260620)
    const pol = await pool.query<{ polname: string }>(`SELECT polname FROM pg_policy WHERE polrelid = 'assessment_facts'::regclass`);
    expect(pol.rows.map((r) => r.polname)).toEqual(["assessment_facts_tenant_isolation"]);
    const trg = await pool.query<{ def: string }>(`SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgrelid = 'assessment_facts'::regclass AND NOT t.tgisinternal`);
    expect(trg.rows).toHaveLength(2);
    for (const r of trg.rows) expect(r.def).not.toMatch(/DELETE|TRUNCATE/);
    // a DELETE as app_request is refused by the grant
    const engA = await createEngagement(asA, fxA, "q2p3-a-grant");
    await asA("put", `/api/vendor-engagements/${engA}/facts`).send({ facts: [{ fact_key: "data.personal_data", value: true }] });
    expect(await sqlstate(asAppRequest(seed.orgA.id, (c) => c.query(`DELETE FROM assessment_facts WHERE subject_id = $1`, [engA])))).toBe("42501");
    expect(await countFor(engA)).toBe(1);
  });

  it("the subject read and the fact_key read use the named indexes", async () => {
    // The named indexes exist with the planned column lists …
    const idx = await pool.query<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'assessment_facts' ORDER BY indexname`);
    const byName = new Map(idx.rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("idx_assessment_facts_subject")).toMatch(/\(organization_id, subject_type, subject_id\)/);
    expect(byName.get("idx_assessment_facts_org_key")).toMatch(/\(organization_id, fact_key\)/);
    expect(byName.get("idx_assessment_facts_subject_accepted")).toMatch(/\(organization_id, subject_type, subject_id, fact_key\) WHERE \(status = 'accepted'/);
    expect(byName.get("assessment_facts_one_accepted_unique")).toMatch(/^CREATE UNIQUE INDEX/);
    expect(byName.get("assessment_facts_live_assertion_unique")).toMatch(/^CREATE UNIQUE INDEX/);
    // … and the planner reaches every lookup path through an assessment_facts index, never a seq scan
    // (on a harness-sized table the planner may pick any prefix-compatible index; the guarantee is "indexed", not "which").
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = async (sql: string, params: unknown[]) => JSON.stringify((await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params)).rows);
      for (const [sql, params] of [
        [`SELECT * FROM assessment_facts WHERE organization_id = $1 AND subject_type = 'vendor_engagement' AND subject_id = $2`, [seed.orgA.id, crypto.randomUUID()]],
        [`SELECT * FROM assessment_facts WHERE organization_id = $1 AND fact_key = 'ai.uses_ai'`, [seed.orgA.id]],
        [`SELECT * FROM assessment_facts WHERE organization_id = $1 AND subject_type = 'vendor_engagement' AND subject_id = $2 AND fact_key = 'ai.uses_ai' AND status = 'accepted'`, [seed.orgA.id, crypto.randomUUID()]],
      ] as Array<[string, unknown[]]>) {
        const p = await plan(sql, params);
        expect(p, sql).not.toMatch(/Seq Scan/);
        expect(p, sql).toMatch(/"Index Name":"(idx_assessment_facts_|assessment_facts_)/);
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("the migration is idempotent — applying it a second time on a populated table is a no-op", async () => {
    const before = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts`);
    expect(before.rows[0]!.n).toBeGreaterThan(0);
    await pool.query(migrationSql());
    const after = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM assessment_facts`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    const trg = await pool.query(`SELECT 1 FROM pg_trigger WHERE tgrelid = 'assessment_facts'::regclass AND NOT tgisinternal`);
    expect(trg.rowCount).toBe(2);
  });

  it("the rollback file removes the table and the forward migration re-applies cleanly (rehearsed inside a rolled-back transaction)", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const rollback = readFileSync(resolve(here, "../../docs/release/ROLLBACK-20261063.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(rollback);
      expect((await client.query(`SELECT 1 FROM pg_class WHERE relname = 'assessment_facts'`)).rowCount).toBe(0);
      await client.query(migrationSql());
      expect((await client.query(`SELECT 1 FROM pg_class WHERE relname = 'assessment_facts'`)).rowCount).toBe(1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
