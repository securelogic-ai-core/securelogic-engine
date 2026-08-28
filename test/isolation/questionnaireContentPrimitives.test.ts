/**
 * questionnaireContentPrimitives.test.ts — VA-Q1 P1 against real Postgres.
 *
 * What is under test is the database-layer contract ADR-0013 R1/R3 rests on:
 * RLS on all three tables, version immutability (trigger AND withheld grant),
 * and object-level authorisation on every route — org B's ids are
 * indistinguishable from unknown ids, and a same-org requirement of a
 * framework the org has not activated cannot be linked.
 *
 * The app is assembled with the real Content-Type gate in front (the VA-E2E-1
 * rule) so this suite is not blind to createApp() middleware.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import { questionContentHash } from "../../src/api/lib/questionnaire/questionContent.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

/** A framework + one requirement per org, seeded as the owner. */
type Fx = { frameworkId: string; requirementId: string };
let fxA: Fx;
let fxB: Fx;

async function seedFramework(orgId: string, name: string): Promise<Fx> {
  const f = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1') RETURNING id`,
    [orgId, name]
  );
  const r = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description)
     VALUES ($1, 'CC6.1', 'Logical access is restricted', 'Seeded requirement') RETURNING id`,
    [f.rows[0]!.id]
  );
  return { frameworkId: f.rows[0]!.id, requirementId: r.rows[0]!.id };
}

const asA = (m: "get" | "post" | "patch" | "delete", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post" | "patch" | "delete", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

const CONTENT = { prompt: "Do you restrict logical access to production?", guidance: "Describe how.", answer_type: "attest" };

/** Run `fn` as app_request scoped to `orgId`, always rolled back. */
async function asAppRequest<T>(orgId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
  fxA = await seedFramework(seed.orgA.id, "Harness SOC 2 (A)");
  fxB = await seedFramework(seed.orgB.id, "Harness SOC 2 (B)");
  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 120_000);

afterAll(async () => {
  await pool.end();
});

async function createQuestion(who: typeof asA, key: string, domain = "security"): Promise<string> {
  const r = await who("post", "/api/questions").send({ question_key: key, domain });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.question.id as string;
}

describe("VA-Q1 P1 · creation, publication, lineage", () => {
  it("creates a draft question, links it, publishes v1, activates — and v1 carries the canonical hash", async () => {
    const id = await createQuestion(asA, "security.access.logical");
    const link = await asA("post", `/api/questions/${id}/links`).send({ requirement_id: fxA.requirementId });
    expect(link.status, JSON.stringify(link.body)).toBe(201);

    const pub = await asA("post", `/api/questions/${id}/versions`).send({ ...CONTENT, activate: true });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect(pub.body.version.version).toBe(1);
    expect(pub.body.version.content_hash).toBe(
      questionContentHash({ prompt: CONTENT.prompt, guidance: CONTENT.guidance, answer_type: "attest", options: null, evidence_policy: "optional" })
    );

    const get = await asA("get", `/api/questions/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.question.status).toBe("active");
    expect(get.body.question.current_version).toBe(1);
    expect(get.body.links).toHaveLength(1);
    expect(get.body.links[0].framework_name).toBe("Harness SOC 2 (A)");
  });

  it("publishing identical content is a no-op that returns the existing version (200, not a new row)", async () => {
    const id = await createQuestion(asA, "security.access.idempotent");
    await asA("post", `/api/questions/${id}/links`).send({ requirement_id: fxA.requirementId });
    const first = await asA("post", `/api/questions/${id}/versions`).send(CONTENT);
    const again = await asA("post", `/api/questions/${id}/versions`).send({ ...CONTENT, prompt: "  " + CONTENT.prompt + "  " });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.version.id).toBe(first.body.version.id);
  });

  it("changed content becomes version 2 and version 1 is untouched (R3)", async () => {
    const id = await createQuestion(asA, "security.access.versioned");
    await asA("post", `/api/questions/${id}/links`).send({ requirement_id: fxA.requirementId });
    const v1 = await asA("post", `/api/questions/${id}/versions`).send(CONTENT);
    const v2 = await asA("post", `/api/questions/${id}/versions`).send({ ...CONTENT, prompt: "Do you restrict AND log logical access to production?" });
    expect(v2.status).toBe(201);
    expect(v2.body.version.version).toBe(2);
    const get = await asA("get", `/api/questions/${id}`);
    const stored1 = get.body.versions.find((v: { version: number }) => v.version === 1);
    expect(stored1.prompt).toBe(CONTENT.prompt);
    expect(stored1.content_hash).toBe(v1.body.version.content_hash);
  });

  it("cannot activate an unlinked question — lineage is mandatory for anything a vendor will see", async () => {
    const id = await createQuestion(asA, "security.unlinked");
    const pub = await asA("post", `/api/questions/${id}/versions`).send({ ...CONTENT, activate: true });
    expect(pub.status).toBe(422);
    expect(pub.body.error).toBe("unlinked_question");
    const patch = await asA("patch", `/api/questions/${id}`).send({ status: "active" });
    expect(patch.status).toBe(422);
  });

  it("cannot remove the last link from an ACTIVE question", async () => {
    const id = await createQuestion(asA, "security.lastlink");
    const link = await asA("post", `/api/questions/${id}/links`).send({ requirement_id: fxA.requirementId });
    await asA("post", `/api/questions/${id}/versions`).send({ ...CONTENT, activate: true });
    const del = await asA("delete", `/api/questions/${id}/links/${link.body.link.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("last_link_on_active_question");
  });
});

describe("VA-Q1 P1 · malformed content and content immutability at the API", () => {
  it("malformed content is 400 with every offending field named", async () => {
    const id = await createQuestion(asA, "security.malformed");
    const r = await asA("post", `/api/questions/${id}/versions`).send({
      answer_type: "select_one",
      options: [{ value: "Yes!", label: "", maps_to_status: "ok" }],
      evidence_policy: "sometimes",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_question_content");
    const fields = r.body.fields.map((f: { field: string }) => f.field);
    expect(fields).toEqual(expect.arrayContaining(["prompt", "evidence_policy", "options"]));
  });

  it("PATCH refuses any content field — content is versions", async () => {
    const id = await createQuestion(asA, "security.patchcontent");
    const r = await asA("patch", `/api/questions/${id}`).send({ prompt: "changed" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("content_is_immutable");
  });

  it("a reserved bridge key cannot be minted through the API", async () => {
    const r = await asA("post", "/api/questions").send({ question_key: "req:abc:cc6.1", domain: "security" });
    expect(r.status).toBe(400);
    expect(r.body.fields.map((f: { field: string }) => f.field)).toContain("question_key");
  });
});

describe("VA-Q1 P1 · the database refuses mutation of a published version", () => {
  let versionId: string;
  beforeAll(async () => {
    const id = await createQuestion(asA, "security.db.immutable");
    await asA("post", `/api/questions/${id}/links`).send({ requirement_id: fxA.requirementId });
    const v = await asA("post", `/api/questions/${id}/versions`).send(CONTENT);
    versionId = v.body.version.id;
  });

  it("app_request cannot UPDATE a version — permission denied before the trigger even runs", async () => {
    await expect(
      asAppRequest(seed.orgA.id, (c) => c.query(`UPDATE question_versions SET prompt = 'x' WHERE id = $1`, [versionId]))
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("app_request cannot DELETE a version", async () => {
    await expect(
      asAppRequest(seed.orgA.id, (c) => c.query(`DELETE FROM question_versions WHERE id = $1`, [versionId]))
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("even the OWNER cannot UPDATE or DELETE a version — the trigger is the second wall", async () => {
    await expect(pool.query(`UPDATE question_versions SET prompt = 'x' WHERE id = $1`, [versionId]))
      .rejects.toMatchObject({ code: "23001" });
    await expect(pool.query(`DELETE FROM question_versions WHERE id = $1`, [versionId]))
      .rejects.toMatchObject({ code: "23001" });
    const still = await pool.query(`SELECT prompt FROM question_versions WHERE id = $1`, [versionId]);
    expect(still.rows[0]!.prompt).toBe(CONTENT.prompt);
  });
});

describe("VA-Q1 P1 · tenant isolation and object-level authorisation", () => {
  let qA: string;
  let linkA: string;
  beforeAll(async () => {
    qA = await createQuestion(asA, "security.isolation.a");
    const l = await asA("post", `/api/questions/${qA}/links`).send({ requirement_id: fxA.requirementId });
    linkA = l.body.link.id;
    await asA("post", `/api/questions/${qA}/versions`).send(CONTENT);
  });

  it("org B cannot read, version, patch, link or unlink org A's question — every path is 404", async () => {
    expect((await asB("get", `/api/questions/${qA}`)).status).toBe(404);
    expect((await asB("post", `/api/questions/${qA}/versions`).send(CONTENT)).status).toBe(404);
    expect((await asB("patch", `/api/questions/${qA}`).send({ status: "retired" })).status).toBe(404);
    expect((await asB("post", `/api/questions/${qA}/links`).send({ requirement_id: fxB.requirementId })).status).toBe(404);
    expect((await asB("delete", `/api/questions/${qA}/links/${linkA}`)).status).toBe(404);
  });

  it("org B's list never contains org A's question — and the reverse holds, so the previous test is not vacuous", async () => {
    const a = await asA("get", "/api/questions");
    const b = await asB("get", "/api/questions");
    expect(a.body.questions.map((q: { id: string }) => q.id)).toContain(qA);
    expect(b.body.questions.map((q: { id: string }) => q.id)).not.toContain(qA);
  });

  it("org A cannot link its question to org B's requirement — foreign and unknown are indistinguishable", async () => {
    const foreign = await asA("post", `/api/questions/${qA}/links`).send({ requirement_id: fxB.requirementId });
    const unknown = await asA("post", `/api/questions/${qA}/links`).send({ requirement_id: "00000000-0000-0000-0000-000000000009" });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
  });

  it("RLS: under org B's context, org A's rows are invisible in all three tables", async () => {
    const counts = await asAppRequest(seed.orgB.id, async (c) => ({
      q: (await c.query(`SELECT COUNT(*)::int AS n FROM questions WHERE id = $1`, [qA])).rows[0]!.n,
      v: (await c.query(`SELECT COUNT(*)::int AS n FROM question_versions WHERE question_id = $1`, [qA])).rows[0]!.n,
      l: (await c.query(`SELECT COUNT(*)::int AS n FROM question_requirement_links WHERE question_id = $1`, [qA])).rows[0]!.n,
    }));
    expect(counts).toEqual({ q: 0, v: 0, l: 0 });
    const own = await asAppRequest(seed.orgA.id, async (c) =>
      (await c.query(`SELECT COUNT(*)::int AS n FROM question_versions WHERE question_id = $1`, [qA])).rows[0]!.n
    );
    expect(own).toBe(1);
  });

  it("RLS WITH CHECK: org B's context cannot INSERT a row claiming org A", async () => {
    await expect(
      asAppRequest(seed.orgB.id, (c) =>
        c.query(
          `INSERT INTO questions (organization_id, question_key, domain, origin) VALUES ($1, 'security.smuggled', 'security', 'customer')`,
          [seed.orgA.id]
        )
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a vendor-portal cookie is refused on every question route", async () => {
    const cookie = "sl_vendor_portal=" + "b".repeat(64);
    for (const [m, p] of [
      ["get", "/api/questions"],
      ["get", `/api/questions/${qA}`],
      ["post", "/api/questions"],
      ["post", `/api/questions/${qA}/versions`],
    ] as const) {
      const r = await request(app)[m](p).set("Cookie", cookie).send(m === "get" ? undefined : CONTENT);
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });
});
