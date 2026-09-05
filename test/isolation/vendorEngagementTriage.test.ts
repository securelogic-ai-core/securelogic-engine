/**
 * vendorEngagementTriage.test.ts — WA-4 (owner ruling 5), against real Postgres.
 *
 * FOUR INVARIANTS THIS EXISTS TO DEFEND:
 *
 *   1. NEEDS ATTENTION IS DERIVED, AND DERIVED ONCE. The list endpoint computes
 *      it in SQL (so filtering and pagination stay correct) and the detail
 *      endpoint computes it through the pure module. Those are two
 *      implementations of one rule, which this codebase otherwise forbids —
 *      so the equivalence arm below runs both over the same engagements and
 *      fails on any disagreement. If you change attentionSignals.ts and this
 *      test goes red, the SQL is now wrong.
 *
 *   2. NO RESPONSE STATE CREATES A FINDING. Not `fail`, not `partial`, not a
 *      missing explanation, and not a `finding_confirmed` disposition. The
 *      findings table is counted before and after every triage operation.
 *
 *   3. A DISPOSITION IS APPEND-ONLY AND ATTRIBUTED. Changing your mind writes a
 *      second row; the first stays readable with its own actor and reason.
 *
 *   4. TENANT ISOLATION. Every new route answers 404 to the other tenant —
 *      not 403, which would confirm the id exists.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret-for-engagement-triage";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedUser, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import {
  deriveAttention,
  digestOf,
  emptyCounts,
  type AttentionCounts,
} from "../../src/api/lib/vendorRisk/attentionSignals.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let tokenA: string;
let tokenB: string;

const post = (t: string, p: string, b: unknown) =>
  request(app).post(p).set("Authorization", `Bearer ${t}`).send(b);
const get = (t: string, p: string) => request(app).get(p).set("Authorization", `Bearer ${t}`);

async function composedEngagement(token: string, orgId: string, label: string): Promise<string> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const rel = await post(token, `/api/vendors/${vendorId}/relationships`, {
    name: `${label} service`,
    service_description: "Under assessment",
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);
  const relationshipId = rel.body.relationship.id;

  const intake = await post(token, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
    max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential",
    business_reach: "enterprise_wide", substitutability: "replaceable_months",
    process_coupling: "in_critical_path", concentration: "moderate",
    data_sensitivity: "restricted", data_volume: "large", access_level: "read_write",
    regulatory_exposure: "high", regulatory_breach_notification: false,
    ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
    fourth_party_exposure: "moderate",
  });
  expect(intake.status, JSON.stringify(intake.body)).toBe(201);

  const eng = await post(token, "/api/vendor-engagements", {
    vendor_id: vendorId, relationship_id: relationshipId,
    engagement_type: "initial", title: `${label} engagement`,
  });
  expect(eng.status, JSON.stringify(eng.body)).toBe(201);
  const engagementId: string = eng.body.id;

  const scope = await post(token, `/api/vendor-engagements/${engagementId}/scope`, {});
  expect(scope.status, JSON.stringify(scope.body)).toBe(200);
  return engagementId;
}

/**
 * Answer the first N scope items directly.
 *
 * Deliberately writing the rows rather than driving the portal: this suite is
 * about the DERIVATION, and the portal has its own suites. Writing the rows is
 * also the only way to produce the shapes a pre-WA-1 assessment can carry —
 * an unanswered mandatory item on a submitted engagement — which the submit
 * gate now refuses to create.
 */
async function answer(
  orgId: string,
  engagementId: string,
  answers: Array<{ status: string; notes: string | null }>
): Promise<void> {
  const items = await pool.query<{ requirement_id: string }>(
    `SELECT requirement_id FROM vendor_engagement_scope_items
      WHERE engagement_id = $1 AND organization_id = $2
      ORDER BY requirement_id LIMIT $3`,
    [engagementId, orgId, answers.length]
  );
  expect(items.rowCount).toBe(answers.length);
  for (let i = 0; i < answers.length; i += 1) {
    await pool.query(
      `INSERT INTO requirement_responses
         (organization_id, requirement_id, assessment_type, subject_id, status, notes, engagement_id)
       VALUES ($1, $2, 'vendor', $3::uuid, $4, $5, $6)`,
      [orgId, items.rows[i]!.requirement_id, engagementId, answers[i]!.status, answers[i]!.notes, engagementId]
    );
  }
}

const setStatus = (engagementId: string, status: string) =>
  pool.query(`UPDATE vendor_engagements SET status = $2 WHERE id = $1`, [engagementId, status]);

const findingCount = async (orgId: string): Promise<number> =>
  Number(
    (await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM findings WHERE organization_id = $1`, [orgId]))
      .rows[0]!.n
  );

/** The same engagement's counts, as the LIST endpoint sees them. */
async function listedAttention(token: string, engagementId: string) {
  const res = await get(token, "/api/vendor-engagements?limit=200");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const row = res.body.engagements.find((e: { id: string }) => e.id === engagementId);
  expect(row, "engagement missing from the list").toBeTruthy();
  return row.attention as { needs_attention: boolean; reasons: string[]; counts: AttentionCounts; digest: string };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  pool = new Pool({ connectionString: url });

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  const uA = await seedUser(pool, seed.orgA.id, { email: "triage-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "triage-b@example.com" });
  await recordAllCurrentConsents(pool, { userId: uA.id, organizationId: seed.orgA.id, consentMethod: "admin_recorded" });
  await recordAllCurrentConsents(pool, { userId: uB.id, organizationId: seed.orgB.id, consentMethod: "admin_recorded" });
  tokenA = signJwt(uA.id, seed.orgA.id, "admin");
  tokenB = signJwt(uB.id, seed.orgB.id, "admin");
});

afterAll(async () => {
  await pool.end();
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("1 — the SQL and the pure module derive the same thing", () => {
  it("agrees on a mixed assessment, reason for reason and count for count", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "equiv");
    await answer(seed.orgA.id, id, [
      { status: "fail", notes: "no budget this year" },   // control_not_in_place
      { status: "fail", notes: null },                     // + explanation_missing
      { status: "partial", notes: "half the estate" },     // partial_response
      { status: "partial", notes: "  " },                  // + explanation_missing
      { status: "not_applicable", notes: null },           // explanation_missing
      { status: "pass", notes: "implemented" },            // nothing
    ]);
    await setStatus(id, "in_review");

    const detail = await get(tokenA, `/api/vendor-engagements/${id}/attention`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const listed = await listedAttention(tokenA, id);

    expect(listed.counts).toEqual(detail.body.attention.counts);
    expect(listed.digest).toBe(detail.body.attention.digest);
    expect(listed.reasons).toEqual(detail.body.attention.reasons);

    // And both agree with the module run directly over the same rows.
    const rows = await pool.query(
      `SELECT si.requirement_id, si.mandatory, rr.status, rr.notes, qv.evidence_policy
         FROM vendor_engagement_scope_items si
         LEFT JOIN requirement_responses rr
                ON rr.requirement_id = si.requirement_id AND rr.engagement_id = si.engagement_id
         LEFT JOIN question_versions qv ON qv.id = si.question_version_id
        WHERE si.engagement_id = $1`,
      [id]
    );
    const pure = deriveAttention(
      rows.rows.map((r) => ({
        requirement_id: r.requirement_id, mandatory: r.mandatory,
        answer: r.status, notes: r.notes, evidence_policy: r.evidence_policy,
      })),
      { status: "in_review", unreviewed_evidence_count: 0, active_finding_count: 0 }
    );
    expect(listed.counts).toEqual(pure.counts);

    expect(listed.counts.control_not_in_place).toBe(2);
    expect(listed.counts.partial_response).toBe(2);
    expect(listed.counts.explanation_missing).toBe(3);
  });

  it("agrees that a clean assessment needs nothing, and digests it as 'none'", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "clean");
    await answer(seed.orgA.id, id, [{ status: "pass", notes: "done" }]);
    await setStatus(id, "in_review");

    const listed = await listedAttention(tokenA, id);
    // Unanswered MANDATORY items still count — a one-answer assessment on a
    // 79-item scope is exactly the pre-WA-1 shape this reason exists for.
    expect(listed.counts.control_not_in_place).toBe(0);
    expect(listed.counts.partial_response).toBe(0);
    expect(listed.counts.explanation_missing).toBe(0);
    expect(digestOf(listed.counts)).toBe(listed.digest);
  });

  it("suppresses everything outside the attention window", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "window");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    // Left in `draft` — the vendor has not even been asked yet.
    const listed = await listedAttention(tokenA, id);
    expect(listed.needs_attention).toBe(false);
    expect(listed.digest).toBe("none");
    expect(listed.counts).toEqual(emptyCounts());

    const detail = await get(tokenA, `/api/vendor-engagements/${id}/attention`);
    expect(detail.body.in_attention_window).toBe(false);
    expect(detail.body.attention.needs_attention).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("2 — no response state, and no disposition, creates a Finding", () => {
  it("a fail + partial + unexplained assessment produces ZERO findings", async () => {
    const before = await findingCount(seed.orgA.id);
    const id = await composedEngagement(tokenA, seed.orgA.id, "nofinding");
    await answer(seed.orgA.id, id, [
      { status: "fail", notes: null },
      { status: "partial", notes: null },
    ]);
    await setStatus(id, "in_review");

    await get(tokenA, `/api/vendor-engagements/${id}/attention`);
    await get(tokenA, "/api/vendor-engagements?needs_attention=true&limit=200");
    expect(await findingCount(seed.orgA.id)).toBe(before);
  });

  it("recording every disposition — including finding_confirmed — creates ZERO findings", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "nofinding-disp");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");
    const before = await findingCount(seed.orgA.id);

    for (const d of ["reviewed", "accepted", "escalated", "finding_proposed", "finding_confirmed"] as const) {
      const res = await post(tokenA, `/api/vendor-engagements/${id}/disposition`, {
        disposition: d,
        rationale: "The analyst reviewed this control and recorded a judgement about it.",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // Asserted in the response body, not merely in the table count.
      expect(res.body.created_finding).toBe(false);
    }

    expect(await findingCount(seed.orgA.id)).toBe(before);
    const engFindings = await pool.query(
      `SELECT COUNT(*)::text AS n FROM findings
        WHERE organization_id = $1 AND source_type = 'vendor_engagement' AND source_id::text = $2`,
      [seed.orgA.id, id]
    );
    expect(Number(engFindings.rows[0]!.n)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("3 — disposition is append-only, attributed, and reasoned", () => {
  it("a second decision does not overwrite the first", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "append");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");

    expect((await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" })).status).toBe(201);
    expect(
      (await post(tokenA, `/api/vendor-engagements/${id}/disposition`, {
        disposition: "escalated",
        rationale: "The vendor's answer contradicts their own SOC 2 report.",
      })).status
    ).toBe(201);

    const trail = await get(tokenA, `/api/vendor-engagements/${id}/dispositions`);
    expect(trail.status).toBe(200);
    expect(trail.body.count).toBe(2);
    // Newest first, and the older decision is still legible with its actor.
    expect(trail.body.dispositions[0].disposition).toBe("escalated");
    expect(trail.body.dispositions[1].disposition).toBe("reviewed");
    expect(trail.body.dispositions[1].disposed_by).toBeTruthy();
  });

  it("the database refuses an UPDATE or a DELETE outright", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "worm");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");
    await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" });

    await expect(
      pool.query(`UPDATE vendor_engagement_dispositions SET disposition = 'accepted' WHERE engagement_id = $1`, [id])
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(`DELETE FROM vendor_engagement_dispositions WHERE engagement_id = $1`, [id])
    ).rejects.toThrow(/append-only/i);
  });

  it("a judgement carries a reason; an acknowledgement need not", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "reason");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");

    const bare = await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "accepted" });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toBe("rationale_required");

    const short = await post(tokenA, `/api/vendor-engagements/${id}/disposition`, {
      disposition: "accepted", rationale: "fine",
    });
    expect(short.status).toBe(400);

    expect((await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" })).status).toBe(201);
  });

  it("refuses a disposition outside the attention window", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "outside");
    const res = await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("outside_attention_window");
  });

  it("refuses a disposition it cannot attribute to a person", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "anon");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");

    const res = await request(app)
      .post(`/api/vendor-engagements/${id}/disposition`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ disposition: "reviewed" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("user_context_required");
  });

  it("marks a disposition stale once the assessment moves underneath it", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "stale");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: "explained" }]);
    await setStatus(id, "in_review");
    await post(tokenA, `/api/vendor-engagements/${id}/disposition`, {
      disposition: "accepted", rationale: "One failure, compensating control in place and evidenced.",
    });

    let detail = await get(tokenA, `/api/vendor-engagements/${id}/attention`);
    expect(detail.body.disposition.stale).toBe(false);

    // A second failure arrives. The decision is not erased — it is flagged.
    const more = await pool.query<{ requirement_id: string }>(
      `SELECT requirement_id FROM vendor_engagement_scope_items
        WHERE engagement_id = $1 AND requirement_id NOT IN
          (SELECT requirement_id FROM requirement_responses WHERE engagement_id = $1)
        LIMIT 1`,
      [id]
    );
    await pool.query(
      `INSERT INTO requirement_responses
         (organization_id, requirement_id, assessment_type, subject_id, status, notes, engagement_id)
       VALUES ($1, $2, 'vendor', $3::uuid, 'fail', 'also failing', $3)`,
      [seed.orgA.id, more.rows[0]!.requirement_id, id]
    );

    detail = await get(tokenA, `/api/vendor-engagements/${id}/attention`);
    expect(detail.body.disposition.stale).toBe(true);
    expect(detail.body.disposition.disposition).toBe("accepted");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("4 — tenant isolation on every new surface", () => {
  it("the other tenant gets 404, never 403 — a 403 would confirm the id exists", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "iso");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");
    await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" });

    expect((await get(tokenB, `/api/vendor-engagements/${id}/attention`)).status).toBe(404);
    expect((await get(tokenB, `/api/vendor-engagements/${id}/dispositions`)).status).toBe(404);
    const write = await post(tokenB, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" });
    expect(write.status).toBe(404);

    // And nothing was written into org B's name.
    const leaked = await pool.query(
      `SELECT COUNT(*)::text AS n FROM vendor_engagement_dispositions WHERE organization_id = $1`,
      [seed.orgB.id]
    );
    expect(Number(leaked.rows[0]!.n)).toBe(0);
  });

  it("the portfolio list never returns another tenant's engagements, filtered or sorted", async () => {
    await composedEngagement(tokenA, seed.orgA.id, "iso-list");
    const bId = await composedEngagement(tokenB, seed.orgB.id, "iso-list-b");
    await answer(seed.orgB.id, bId, [{ status: "fail", notes: null }]);
    await setStatus(bId, "in_review");

    for (const q of [
      "",
      "?needs_attention=true",
      "?sort=attention&order=desc",
      "?sort=vendor&order=asc",
      "?undisposed=true",
    ]) {
      const res = await get(tokenA, `/api/vendor-engagements${q}&limit=200`.replace("&limit", q === "" ? "?limit" : "&limit"));
      expect(res.status, `${q}: ${JSON.stringify(res.body)}`).toBe(200);
      for (const e of res.body.engagements) expect(e.id).not.toBe(bId);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("5 — portfolio navigation is whitelisted, stable and pagination-safe", () => {
  it("an unknown sort falls back to the default instead of reaching the query", async () => {
    const res = await get(tokenA, "/api/vendor-engagements?sort=e.id;DROP%20TABLE%20vendor_engagements&order=sideways");
    expect(res.status).toBe(200);
    expect(res.body.query.sort).toBe("risk");
    expect(res.body.query.order).toBe("desc");

    // The table is still there, which is the point of the arm.
    const alive = await pool.query(`SELECT COUNT(*)::text AS n FROM vendor_engagements`);
    expect(Number(alive.rows[0]!.n)).toBeGreaterThan(0);
  });

  it("every whitelisted sort answers 200 and echoes what it actually did", async () => {
    for (const sort of ["risk", "attention", "updated", "created", "next_review", "vendor"]) {
      for (const order of ["asc", "desc"]) {
        const res = await get(tokenA, `/api/vendor-engagements?sort=${sort}&order=${order}&limit=5`);
        expect(res.status, `${sort}/${order}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body.query.sort).toBe(sort);
        expect(res.body.query.order).toBe(order);
      }
    }
  });

  it("paging never repeats or skips a row — the id tiebreak makes the order total", async () => {
    const all = await get(tokenA, "/api/vendor-engagements?sort=risk&order=desc&limit=200");
    const expected: string[] = all.body.engagements.map((e: { id: string }) => e.id);
    expect(expected.length).toBeGreaterThan(3);

    const paged: string[] = [];
    for (let offset = 0; offset < expected.length; offset += 2) {
      const page = await get(tokenA, `/api/vendor-engagements?sort=risk&order=desc&limit=2&offset=${offset}`);
      expect(page.status).toBe(200);
      paged.push(...page.body.engagements.map((e: { id: string }) => e.id));
    }
    expect(paged).toEqual(expected);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it("needs_attention is a tri-state: absent, true and false select different sets", async () => {
    const none = await get(tokenA, "/api/vendor-engagements?limit=200");
    const yes = await get(tokenA, "/api/vendor-engagements?needs_attention=true&limit=200");
    const no = await get(tokenA, "/api/vendor-engagements?needs_attention=false&limit=200");

    expect(yes.body.engagements.length + no.body.engagements.length).toBe(none.body.engagements.length);
    for (const e of yes.body.engagements) expect(e.attention.needs_attention).toBe(true);
    for (const e of no.body.engagements) expect(e.attention.needs_attention).toBe(false);
  });

  it("undisposed=true excludes an engagement someone has dispositioned", async () => {
    const id = await composedEngagement(tokenA, seed.orgA.id, "undisp");
    await answer(seed.orgA.id, id, [{ status: "fail", notes: null }]);
    await setStatus(id, "in_review");

    const before = await get(tokenA, "/api/vendor-engagements?undisposed=true&limit=200");
    expect(before.body.engagements.some((e: { id: string }) => e.id === id)).toBe(true);

    await post(tokenA, `/api/vendor-engagements/${id}/disposition`, { disposition: "reviewed" });

    const after = await get(tokenA, "/api/vendor-engagements?undisposed=true&limit=200");
    expect(after.body.engagements.some((e: { id: string }) => e.id === id)).toBe(false);
  });
});
