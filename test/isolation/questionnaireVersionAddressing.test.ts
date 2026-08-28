/**
 * questionnaireVersionAddressing.test.ts — VA-Q1 P2 against real Postgres.
 *
 * The one proof ADR-0013 R3 rests on, end to end through the real routes:
 *
 *   a requirement edited AFTER the questionnaire is issued changes NOTHING the
 *   vendor or the reviewer sees, and the issued questionnaire still hashes to
 *   its stamp — while the SAME edit is reflected in the next engagement.
 *
 * Plus: scope items are addressed by version, answers and revisions record
 * which version they answered, the integrity route's four verdicts, and that
 * org B cannot reach any of it.
 *
 * Real Content-Type gate in front (the VA-E2E-1 rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import { PORTAL_SESSION_COOKIE } from "../../src/api/lib/vendorPortal/portalTokens.js";
import { questionSetHash } from "../../src/api/lib/questionnaire/bridgeQuestions.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

const asA = (m: "get" | "post" | "patch", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post" | "patch", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

/** Tier-1 intake: every activated requirement lands in scope (S1 baseline "*"). */
const TIER1_INTAKE = {
  engagement_type: "initial",
  data_sensitivity: "restricted", data_volume: "large", access_level: "admin",
  operational_dependency: "critical", recoverability: "weeks", business_criticality: "critical",
  regulatory_exposure: "high", regulatory_breach_notification: true,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "low", concentration: "low",
};

type Fx = { vendorId: string; frameworkId: string; requirementId: string };
let fxA: Fx;
let fxB: Fx;

async function seedOrg(orgId: string, label: string): Promise<Fx> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor`, criticality: "critical" });
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  const req = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
     VALUES ($1, 'VA-1', 'Original title', 'Original guidance', '{core}', 'curated', NOW()) RETURNING id`,
    [fw.rows[0]!.id]
  );
  return { vendorId, frameworkId: fw.rows[0]!.id, requirementId: req.rows[0]!.id };
}

async function openIssuedEngagement(who: typeof asA, fx: Fx, title: string) {
  const created = await who("post", "/api/vendor-engagements").send({ ...TIER1_INTAKE, vendor_id: fx.vendorId, title });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  const scoped = await who("post", `/api/vendor-engagements/${id}/scope`).send({});
  expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
  const issued = await who("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: `${title}@example.com` });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return { id, token: issued.body.invite_token as string };
}

async function portalCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  fxA = await seedOrg(seed.orgA.id, "P2-A");
  fxB = await seedOrg(seed.orgB.id, "P2-B");
  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool.end();
});

describe("VA-Q1 P2 · scope is addressed by an immutable version", () => {
  it("resolving scope bridges the requirement into an active, linked question version and stamps it on the item", async () => {
    const { id } = await openIssuedEngagement(asA, fxA, "p2-addressing");
    const items = await pool.query<{ question_version_id: string | null }>(
      `SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [id]
    );
    expect(items.rowCount).toBe(1);
    expect(items.rows[0]!.question_version_id).toBeTruthy();

    const q = await pool.query<{ question_key: string; status: string; origin: string; prompt: string; guidance: string; n_links: string }>(
      `SELECT q.question_key, q.status, q.origin, v.prompt, v.guidance,
              (SELECT COUNT(*)::text FROM question_requirement_links l WHERE l.question_id = q.id) AS n_links
         FROM question_versions v JOIN questions q ON q.id = v.question_id
        WHERE v.id = $1`,
      [items.rows[0]!.question_version_id]
    );
    expect(q.rows[0]!.question_key).toMatch(/^req:/);
    expect(q.rows[0]!.status).toBe("active");
    expect(q.rows[0]!.origin).toBe("securelogic");
    expect(q.rows[0]!.prompt).toBe("Original title");
    expect(q.rows[0]!.guidance).toBe("Original guidance");
    expect(q.rows[0]!.n_links).toBe("1");
  });

  it("issue stamps a content-addressed hash that recomputes from the stored items — integrity says match", async () => {
    const { id } = await openIssuedEngagement(asA, fxA, "p2-stamp");
    const eng = await pool.query<{ question_set_hash: string | null; question_set_hash_at: string | null }>(
      `SELECT question_set_hash, question_set_hash_at FROM vendor_engagements WHERE id = $1`, [id]
    );
    expect(eng.rows[0]!.question_set_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eng.rows[0]!.question_set_hash_at).toBeTruthy();

    const r = await asA("get", `/api/vendor-engagements/${id}/integrity`);
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe("match");
    expect(r.body.computed_hash).toBe(eng.rows[0]!.question_set_hash);
    expect(r.body.unversioned_items).toBe(0);
  });

  it("the same scope → the same hash across two engagements (deterministic addressing)", async () => {
    const a = await openIssuedEngagement(asA, fxA, "p2-det-1");
    const b = await openIssuedEngagement(asA, fxA, "p2-det-2");
    const rows = await pool.query<{ question_set_hash: string }>(
      `SELECT question_set_hash FROM vendor_engagements WHERE id = ANY($1::uuid[]) ORDER BY id`, [[a.id, b.id]]
    );
    expect(rows.rows[0]!.question_set_hash).toBe(rows.rows[1]!.question_set_hash);
  });
});

describe("VA-Q1 P2 · the R3 proof: a library edit after issue changes nothing that was issued", () => {
  let issued: { id: string; token: string };
  let stampedHash: string;
  let v1: string;

  beforeAll(async () => {
    issued = await openIssuedEngagement(asA, fxA, "p2-r3");
    const eng = await pool.query<{ question_set_hash: string }>(`SELECT question_set_hash FROM vendor_engagements WHERE id = $1`, [issued.id]);
    stampedHash = eng.rows[0]!.question_set_hash;
    const item = await pool.query<{ question_version_id: string }>(`SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [issued.id]);
    v1 = item.rows[0]!.question_version_id;

    // The vendor answers BEFORE the edit, so the response records v1.
    const cookie = await portalCookie(issued.token);
    const ans = await request(app).put(`/api/vendor-portal/questions/${fxA.requirementId}`).set("Cookie", cookie)
      .send({ answer: "pass", notes: "answered against the original text" });
    expect(ans.status, JSON.stringify(ans.body)).toBe(200);

    // THE EDIT. The requirement's title and description change in the library.
    const edit = await asA("patch", `/api/requirements/${fxA.requirementId}`).send({ description: "EDITED guidance after issue" });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    await pool.query(`UPDATE requirements SET title = 'EDITED title after issue' WHERE id = $1`, [fxA.requirementId]);
  });

  it("the vendor still reads the ORIGINAL text in the portal", async () => {
    const cookie = await portalCookie(issued.token);
    const r = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.questions).toHaveLength(1);
    expect(r.body.questions[0].title).toBe("Original title");
    expect(r.body.questions[0].guidance).toBe("Original guidance");
  });

  it("the reviewer still reads the ORIGINAL text, addressed by the same version", async () => {
    const r = await asA("get", `/api/vendor-engagements/${issued.id}/responses`);
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].requirement.title).toBe("Original title");
    expect(r.body.items[0].requirement.description).toBe("Original guidance");
    expect(r.body.items[0].question_version_id).toBe(v1);
  });

  it("the issued questionnaire still hashes to its stamp — integrity: match", async () => {
    const r = await asA("get", `/api/vendor-engagements/${issued.id}/integrity`);
    expect(r.body.verdict).toBe("match");
    expect(r.body.stamped_hash).toBe(stampedHash);
  });

  it("the answer and its revision record the version that was answered", async () => {
    const resp = await pool.query<{ question_version_id: string }>(
      `SELECT question_version_id FROM requirement_responses WHERE engagement_id = $1`, [issued.id]
    );
    expect(resp.rows[0]!.question_version_id).toBe(v1);
    const rev = await pool.query<{ question_version_id: string }>(
      `SELECT r.question_version_id FROM requirement_response_revisions r
         JOIN requirement_responses rr ON rr.id = r.response_id WHERE rr.engagement_id = $1`, [issued.id]
    );
    expect(rev.rows.map((x) => x.question_version_id)).toEqual([v1]);
  });

  it("but a NEW engagement composed after the edit asks the EDITED text as version 2 — and v1 still exists", async () => {
    const next = await openIssuedEngagement(asA, fxA, "p2-after-edit");
    const cookie = await portalCookie(next.token);
    const r = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);
    expect(r.body.questions[0].title).toBe("EDITED title after issue");
    expect(r.body.questions[0].guidance).toBe("EDITED guidance after issue");

    const item = await pool.query<{ question_version_id: string }>(`SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [next.id]);
    const v2 = item.rows[0]!.question_version_id;
    expect(v2).not.toBe(v1);
    const versions = await pool.query<{ version: number; prompt: string }>(
      `SELECT version, prompt FROM question_versions WHERE question_id = (SELECT question_id FROM question_versions WHERE id = $1) ORDER BY version`, [v1]
    );
    expect(versions.rows.map((v) => [v.version, v.prompt])).toEqual([[1, "Original title"], [2, "EDITED title after issue"]]);

    // Different content → different questionnaire identity.
    const h = await pool.query<{ question_set_hash: string }>(`SELECT question_set_hash FROM vendor_engagements WHERE id = $1`, [next.id]);
    expect(h.rows[0]!.question_set_hash).not.toBe(stampedHash);
  });

  it("an issued questionnaire whose items were tampered with reports drift, loudly", async () => {
    // Simulate the one thing the schema cannot prevent by itself: an item's
    // depth changed under an issued engagement (as the owner, bypassing RLS).
    await pool.query(`UPDATE vendor_engagement_scope_items SET depth = 'attest' WHERE engagement_id = $1`, [issued.id]);
    const r = await asA("get", `/api/vendor-engagements/${issued.id}/integrity`);
    expect(r.body.verdict).toBe("drift");
    expect(r.body.computed_hash).not.toBe(r.body.stamped_hash);
    await pool.query(`UPDATE vendor_engagement_scope_items SET depth = 'full' WHERE engagement_id = $1`, [issued.id]);
    const back = await asA("get", `/api/vendor-engagements/${issued.id}/integrity`);
    expect(back.body.verdict).toBe("match");
  });
});

describe("VA-Q1 P2 · verdict vocabulary and tenant boundary", () => {
  it("a draft engagement is 'unissued'; a pre-P2 item set is 'unstamped'", async () => {
    const created = await asA("post", "/api/vendor-engagements").send({ ...TIER1_INTAKE, vendor_id: fxA.vendorId, title: "p2-draft" });
    const draft = await asA("get", `/api/vendor-engagements/${created.body.id}/integrity`);
    expect(draft.body.verdict).toBe("unissued");

    // A historical engagement: scope items with NO version (written before P2).
    const legacy = await openIssuedEngagement(asA, fxA, "p2-legacy");
    await pool.query(`UPDATE vendor_engagement_scope_items SET question_version_id = NULL WHERE engagement_id = $1`, [legacy.id]);
    const r = await asA("get", `/api/vendor-engagements/${legacy.id}/integrity`);
    expect(r.body.verdict).toBe("unstamped");
    expect(r.body.unversioned_items).toBe(1);
    // …and it still RENDERS, falling back to the requirement text.
    const cookie = await portalCookie(legacy.token);
    const q = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);
    expect(q.status).toBe(200);
    expect(q.body.questions[0].title).toBe("EDITED title after issue");
  });

  it("org B cannot read org A's integrity, and org A's engagement is invisible to org B's resolver", async () => {
    const a = await openIssuedEngagement(asA, fxA, "p2-xorg");
    expect((await asB("get", `/api/vendor-engagements/${a.id}/integrity`)).status).toBe(404);
    expect((await asB("get", `/api/vendor-engagements/${a.id}/responses`)).status).toBe(404);

    // Org B's bridge question for ITS requirement never sees org A's rows.
    const b = await openIssuedEngagement(asB, fxB, "p2-b");
    const cross = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_engagement_scope_items si
         JOIN question_versions qv ON qv.id = si.question_version_id
        WHERE si.engagement_id = $1 AND qv.organization_id <> si.organization_id`,
      [b.id]
    );
    expect(cross.rows[0]!.n).toBe("0");
  });

  it("the hash helper and the stamp agree on the canonical form (no second implementation)", async () => {
    const e = await openIssuedEngagement(asA, fxA, "p2-canon");
    const rows = await pool.query<{ content_hash: string; depth: string; mandatory: boolean; requirement_id: string }>(
      `SELECT qv.content_hash, si.depth, si.mandatory, si.requirement_id
         FROM vendor_engagement_scope_items si JOIN question_versions qv ON qv.id = si.question_version_id
        WHERE si.engagement_id = $1`, [e.id]
    );
    const stamped = await pool.query<{ question_set_hash: string }>(`SELECT question_set_hash FROM vendor_engagements WHERE id = $1`, [e.id]);
    expect(questionSetHash(rows.rows)).toBe(stamped.rows[0]!.question_set_hash);
  });
});
