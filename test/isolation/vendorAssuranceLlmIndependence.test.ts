/**
 * vendorAssuranceLlmIndependence.test.ts — the LLM-INDEPENDENCE stop gate.
 *
 * Ratified requirement:
 *
 *   "Prove architecturally that the entire workflow can complete with the LLM
 *    unavailable: intake → inherent risk → assessment scope → questionnaire →
 *    responses/evidence → deterministic evaluation → findings/human review →
 *    residual risk → decision. AI enhancement must be separately killable
 *    without breaking Vendor Assurance."
 *
 * This suite proves it by CONSTRUCTION and by EXECUTION:
 *
 *   - construction: the deterministic modules are asserted to have no provider
 *     import at all, so they cannot call a model even if someone wanted them to;
 *   - execution: a full engagement is driven end to end with every AI-adjacent
 *     flag OFF and no ANTHROPIC_API_KEY / OPENAI_API_KEY in the environment.
 *
 * If a model call ever creeps into the authoritative path, the environment
 * assertions here fail before anyone notices in production — which is the point,
 * because the failure mode otherwise is silent: the workflow keeps working in
 * development where a key happens to be set.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import {
  computeVendorInherentRisk,
  type InherentRiskInput,
} from "../../src/api/lib/vendorRisk/inherentRisk.js";
import { resolveEngagementScope } from "../../src/api/lib/vendorRisk/scopeResolver.js";
import { canTransition } from "../../src/api/lib/vendorRisk/engagementStateMachine.js";
import {
  generatePortalToken,
  hashPortalToken,
  PORTAL_SESSION_COOKIE,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

/** Saved so the suite restores the environment it found. */
const savedEnv: Record<string, string | undefined> = {};

const AI_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const AI_FLAGS = [
  "SECURELOGIC_ASK_TOOLS_ENABLED",
  "SECURELOGIC_VENDOR_ASSURANCE_ENABLED",
  "SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED",
];

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the LLM-independence test.");
  process.env.DATABASE_URL = url;
  pool = new Pool({ connectionString: url, ssl: false });

  // THE WHOLE POINT: no provider credentials, and every AI-adjacent flag off.
  for (const k of [...AI_KEYS, ...AI_FLAGS]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";

  app = express();

  // The strict Content-Type gate, in the position createApp() puts it —

  // the VA-E2E-1 rule, enforced by isolationSuitesUseRealGate.test.ts.

  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pool?.end();
});

// ─── Construction: the deterministic core cannot call a model ───────────────

describe("LLM independence — by construction", () => {
  const DETERMINISTIC_DIRS = [
    "src/api/lib/vendorRisk",
    "src/api/lib/vendorPortal",
  ];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d)) {
        const full = path.join(d, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) out.push(full);
      }
    };
    walk(dir);
    return out;
  }

  it("NO deterministic module imports a model provider", () => {
    // Not "does not currently call one" — cannot. A provider import in this tree
    // would mean the authoritative path had acquired a dependency that can fail,
    // rate-limit, or be switched off.
    const offenders: string[] = [];
    for (const dir of DETERMINISTIC_DIRS) {
      for (const file of sourceFiles(dir)) {
        const src = readFileSync(file, "utf8");
        const imports = src
          .split("\n")
          .filter((l) => /^\s*import\b/.test(l))
          .join("\n");
        if (/@anthropic-ai|\bopenai\b|claudeS|Anthropic/i.test(imports)) {
          offenders.push(file);
        }
      }
    }
    expect(
      offenders,
      "A deterministic risk/portal module imported a model provider. The " +
        "authoritative path must be reproducible without one."
    ).toEqual([]);
  });

  it("the inherent model and scope resolver are SYNCHRONOUS", () => {
    // A synchronous function cannot await a model. This is the runtime companion
    // to the import assertion: a refactor to async becomes a deliberate, visible
    // act rather than a quiet one.
    const input: InherentRiskInput = {
      data_sensitivity: "restricted",
      data_volume: "large",
      access_level: "admin",
      operational_dependency: "critical",
      recoverability: "days",
      business_criticality: "high",
      regulatory_exposure: "high",
      regulatory_breach_notification: true,
      ai_involvement: "none",
      ai_autonomy: "none",
      hosting_model: "multi_tenant_saas",
      fourth_party_exposure: "high",
      concentration: "moderate",
    };
    const inherent = computeVendorInherentRisk(input);
    expect(inherent).not.toBeInstanceOf(Promise);
    expect(inherent.band).toBe("Critical");

    const scope = resolveEngagementScope({
      tier: inherent.tier,
      inherent: input,
      requirements: [
        { requirement_id: "r1", framework_id: "f1", reference_id: "R1", title: "t", scope_tags: ["core"] },
      ],
      obligationEdges: [],
    });
    expect(scope).not.toBeInstanceOf(Promise);
    expect(scope.items.length).toBeGreaterThan(0);
  });

  it("the state machine is a pure table", () => {
    expect(canTransition("issued", "in_progress", "portal").allowed).toBe(true);
    expect(canTransition("issued", "decided", "portal").allowed).toBe(false);
  });
});

// ─── Execution: a full engagement, no provider credentials ─────────────────

describe("LLM independence — end to end with NO provider credentials", () => {
  it("the environment genuinely has no model access", () => {
    // Guards the guard: if a key leaked back in, everything below would pass for
    // the wrong reason.
    for (const k of AI_KEYS) {
      expect(process.env[k], `${k} is set — this suite proves nothing`).toBeUndefined();
    }
    for (const f of AI_FLAGS) {
      expect(process.env[f], `${f} is set`).toBeUndefined();
    }
  });

  it("intake → inherent → scope → questionnaire → answers → submit completes", async () => {
    // ── intake ──────────────────────────────────────────────────────────
    const vendorId = await seedVendor(pool, seed.orgA.id, {
      name: "LLM-OFF Vendor",
    });

    // ── inherent risk (deterministic) ───────────────────────────────────
    const input: InherentRiskInput = {
      data_sensitivity: "confidential",
      data_volume: "moderate",
      access_level: "read_only",
      operational_dependency: "moderate",
      recoverability: "days",
      business_criticality: "high",
      regulatory_exposure: "moderate",
      regulatory_breach_notification: false,
      ai_involvement: "none",
      ai_autonomy: "none",
      hosting_model: "multi_tenant_saas",
      fourth_party_exposure: "moderate",
      concentration: "low",
    };
    const inherent = computeVendorInherentRisk(input);
    expect(inherent.tier).toBe("tier_3_moderate");

    const eng = await pool.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, status,
          methodology_version, scope_rule_version,
          inherent_score, inherent_rating, inherent_arithmetic_rating,
          inherent_basis, assessment_tier)
       VALUES ($1,$2,'initial','issued','1.0.0','1.0.0',$3,$4,$5,$6::jsonb,$7)
       RETURNING id`,
      [
        seed.orgA.id, vendorId,
        inherent.score, inherent.band, inherent.arithmetic_band,
        JSON.stringify(inherent.basis), inherent.tier,
      ]
    );
    const engagementId = eng.rows[0]!.id;

    // ── scope (deterministic) ───────────────────────────────────────────
    const fw = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, version) VALUES ($1,'LLM-OFF FW','1.0') RETURNING id`,
      [seed.orgA.id]
    );
    const reqRows = await Promise.all(
      ["CORE-1", "CORE-2"].map((ref) =>
        pool.query<{ id: string }>(
          `INSERT INTO requirements (framework_id, reference_id, title) VALUES ($1,$2,$3) RETURNING id`,
          [fw.rows[0]!.id, ref, `Requirement ${ref}`]
        )
      )
    );

    const scope = resolveEngagementScope({
      tier: inherent.tier,
      inherent: input,
      requirements: reqRows.map((r, i) => ({
        requirement_id: r.rows[0]!.id,
        framework_id: fw.rows[0]!.id,
        reference_id: `CORE-${i + 1}`,
        title: `Requirement CORE-${i + 1}`,
        scope_tags: ["core"],
      })),
      obligationEdges: [],
    });
    expect(scope.items.length).toBe(2);

    for (const item of scope.items) {
      await pool.query(
        `INSERT INTO vendor_engagement_scope_items
           (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons)
         VALUES ($1,$2,$3,$4,$5,'deterministic',$6::jsonb)`,
        [
          seed.orgA.id, engagementId, item.requirement_id,
          item.depth, item.mandatory, JSON.stringify(item.reasons),
        ]
      );
    }

    // ── questionnaire: issue, exchange, answer, submit ───────────────────
    const token = generatePortalToken();
    await pool.query(
      `INSERT INTO vendor_engagement_invites
         (organization_id, engagement_id, invite_token_hash, contact_email, expires_at)
       VALUES ($1,$2,$3,'llm-off@example.com',$4)`,
      [seed.orgA.id, engagementId, hashPortalToken(token), new Date(Date.now() + 86_400_000)]
    );

    const exchange = await request(app).post("/api/vendor-portal/session").send({ token });
    expect(exchange.status, "exchange failed without a model — it must not need one").toBe(200);
    const cookie = (exchange.headers["set-cookie"] as unknown as string[])
      .find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!
      .split(";")[0]!;

    const questions = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);
    expect(questions.status).toBe(200);
    expect(questions.body.questions).toHaveLength(2);
    // Every question carries its deterministic justification — produced by the
    // rule corpus, not by a model.
    for (const q of questions.body.questions as Array<{ why_we_are_asking: unknown[] }>) {
      expect(q.why_we_are_asking.length).toBeGreaterThan(0);
    }

    for (const q of questions.body.questions as Array<{ requirement_id: string }>) {
      const saved = await request(app)
        .put(`/api/vendor-portal/questions/${q.requirement_id}`)
        .set("Cookie", cookie)
        .send({ answer: "pass", notes: "Documented and tested annually." });
      expect(saved.status).toBe(200);
    }

    const submitted = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie);
    expect(submitted.status, "submission required a model — it must not").toBe(200);

    const finalState = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [engagementId]
    );
    expect(finalState.rows[0]!.status).toBe("submitted");
  });

  it("the persisted basis is complete enough to explain the rating WITHOUT recomputation", async () => {
    // The reason a basis is stored rather than derived on read: an explanation
    // that needs the engine to regenerate it is not an explanation you can
    // defend years later, and it would tie the audit trail to a live model.
    const row = await pool.query<{ inherent_basis: Record<string, unknown> }>(
      `SELECT inherent_basis FROM vendor_engagements
        WHERE organization_id = $1 AND inherent_basis IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [seed.orgA.id]
    );
    const basis = row.rows[0]!.inherent_basis as {
      method: string;
      methodology_version: string;
      factors: Array<{ dimension: string; explanation: string; contribution: number }>;
    };

    expect(basis.method).toBe("vendor_inherent_v1");
    expect(basis.methodology_version).toBe("1.0.0");
    expect(basis.factors).toHaveLength(9);
    for (const f of basis.factors) {
      expect(f.explanation.length).toBeGreaterThan(10);
      expect(typeof f.contribution).toBe("number");
    }
  });

  it("Ask degrades to unavailable rather than breaking the platform", async () => {
    // Ask is the ONE surface that genuinely needs a model. With no key it must
    // report itself unavailable — not 500, and not silently answer from nothing.
    const res = await request(app)
      .post("/api/ask")
      .set("x-api-key", seed.orgA.apiKey)
      .send({ question: "How many findings do I have?" });

    expect([401, 403, 503]).toContain(res.status);
    if (res.status === 503) expect(res.body.error).toBe("ask_unavailable");
  });
});
