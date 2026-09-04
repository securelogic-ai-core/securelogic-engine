/**
 * vendorAssuranceContentBoundary.test.ts — the VA-6 (#872) activation contract.
 *
 * VA-6 puts a questionnaire CONTENT layer (guidance + scope tags) on the
 * FRAMEWORKS spine: PATCH /api/requirements/:id and
 * GET /api/requirements/scope-tag-coverage. Those two routes are deliberately
 * NOT behind SECURELOGIC_VENDOR_ASSURANCE_ENABLED — `requirements` is core GRC
 * reference data that has been live in production since long before Vendor
 * Assurance existed, and it is gated the way its siblings are: premium
 * entitlement, no contributor seat, org-admin role on every write.
 *
 * That makes "does VA-6 activate Vendor Assurance?" a DATA-FLOW question rather
 * than a route question. Curated tags and guidance are inert reference data
 * until something CONSUMES them, and every consumer sits behind an activation
 * flag:
 *
 *   requirements.scope_tags  -> scopeResolver -> POST /api/vendor-engagements/:id/scope
 *                               (vendorAssuranceFeatureFlag, first in the chain)
 *   requirements.description -> "guidance"   -> GET  /api/vendor-portal/questions
 *                               (vendorPortalFeatureFlag — pinned by
 *                                vendorPortalStaticInvariants.test.ts)
 *
 * This file pins that shape so a LATER package cannot add a consumer outside
 * the flag without a test going red. The flag resolver's own truth table lives
 * in vendorAssuranceFeatureFlag.test.ts; what is new here is the interaction
 * with entitlement and the census that keeps the consumer set closed.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ENGAGEMENT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

// Entitlement verdict for the current case, flipped per test.
let entitled = true;

const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: () => query() },
  pgElevated: { query: () => query() },
  withTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn(),
  writeAuditEventAwaited: vi.fn(async () => true),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: express.Request, _r: express.Response, n: express.NextFunction) => {
    (req as never as Record<string, unknown>).apiKey = { id: "k-1" };
    (req as never as Record<string, unknown>).userId = "u-1";
    n();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (
    req: express.Request,
    _r: express.Response,
    n: express.NextFunction
  ) => {
    (req as never as Record<string, unknown>).organizationContext = { organizationId: ORG };
    n();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_q: express.Request, r: express.Response, n: express.NextFunction) => {
    if (!entitled) {
      r.status(403).json({ error: "insufficient_entitlement" });
      return;
    }
    n();
  },
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_q: express.Request, _r: express.Response, n: express.NextFunction) => n(),
  requireSeat: () => (_q: express.Request, _r: express.Response, n: express.NextFunction) => n(),
}));
vi.mock("../middleware/asTenant.js", () => ({ asTenant: (h: express.RequestHandler) => h }));

// vendorAssuranceFeatureFlag is intentionally REAL — it is the subject.
import vendorEngagementsRouter from "../routes/vendorEngagements.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", vendorEngagementsRouter);
  // A route MISS answers with a `path` field; the flag's 404 does not. That
  // difference is what makes "dark" provable rather than assumed.
  a.use((req, res) => res.status(404).json({ error: "not_found", path: req.path }));
  return a;
}

/** The one route that turns curated scope_tags into a real questionnaire. */
const SCOPE_ROUTE = `/api/vendor-engagements/${ENGAGEMENT}/scope`;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  entitled = true;
  delete process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"];
  // vendorAssuranceEnabled() opens off-production for developer convenience,
  // so every FLAG-FALSE case must state production explicitly. Staging runs
  // with the flag ON; production runs with it absent.
  process.env["NODE_ENV"] = "production";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// FLAG FALSE — curation is possible, consumption is not.
// ---------------------------------------------------------------------------

describe("FLAG FALSE — VA-6 content cannot become an operating questionnaire", () => {
  it("scope resolution — the only consumer of curated scope_tags — is 404", async () => {
    const res = await request(app()).post(SCOPE_ROUTE).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("no database work runs — the gate precedes every handler", async () => {
    await request(app()).post(SCOPE_ROUTE).send({});
    expect(query).not.toHaveBeenCalled();
  });

  it("a valid premium entitlement CANNOT bypass the flag", async () => {
    entitled = true;
    const res = await request(app()).post(SCOPE_ROUTE).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("the dark surface leaks strictly less than a genuine route miss", async () => {
    const dark = await request(app()).post(SCOPE_ROUTE).send({});
    const absent = await request(app()).post(`/api/vendor-engagements-not-real/x/scope`).send({});
    expect(dark.status).toBe(absent.status);
    expect(dark.body).not.toHaveProperty("path");
    expect(absent.body).toHaveProperty("path");
  });

  it("EVERY vendor-engagement route is flag-gated FIRST — including any added later", () => {
    // Structural, not per-URL: the flag is the first entry of the shared chain
    // every route in the file spreads, so a route a later package adds inherits
    // it without anyone remembering to.
    type Layer = { route?: { path: string; stack: Array<{ handle: { name: string } }> } };
    const layers = (vendorEngagementsRouter as unknown as { stack: Layer[] }).stack;
    const routes = layers.filter((l) => l.route);
    expect(routes.length).toBeGreaterThan(10);
    for (const layer of routes) {
      expect(
        layer.route!.stack[0]?.handle.name,
        `${layer.route!.path} must be gated by vendorAssuranceFeatureFlag FIRST`
      ).toBe("vendorAssuranceFeatureFlag");
    }
  });
});

// ---------------------------------------------------------------------------
// FLAG TRUE + NO ENTITLEMENT — the second control still refuses.
// ---------------------------------------------------------------------------

describe("FLAG TRUE + NO ENTITLEMENT — still unavailable", () => {
  beforeEach(() => {
    process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
    entitled = false;
  });

  it("the entitlement gate refuses after the flag lets the request through", async () => {
    const res = await request(app()).post(SCOPE_ROUTE).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "insufficient_entitlement" });
  });

  it("turning the flag on grants nothing entitlement would have refused", async () => {
    await request(app()).post(SCOPE_ROUTE).send({});
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FLAG TRUE + VALID ENTITLEMENT — the capability operates, authorization intact.
// ---------------------------------------------------------------------------

describe("FLAG TRUE + VALID ENTITLEMENT — scope resolution operates again", () => {
  beforeEach(() => {
    process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
    entitled = true;
  });

  it("the request reaches the handler and is answered on its own terms", async () => {
    const res = await request(app()).post(SCOPE_ROUTE).send({});
    // The stubbed database owns no engagement, so the handler's OWN 404
    // answers — a different body from the flag's, which is the point: the
    // gate is no longer intercepting.
    expect(query).toHaveBeenCalled();
    expect(res.body).toEqual({ error: "engagement_not_found" });
    expect(res.body).not.toEqual({ error: "not_found" });
  });

  it("the engagement lookup is org-scoped — tenancy is not relaxed by the flag", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../routes/vendorEngagements.ts"),
      "utf8"
    );
    // resolveScope reads the engagement and then every requirement in the org.
    // Both predicates carry organization_id; without them a curated corpus
    // could be resolved against another tenant's engagement.
    expect(source).toContain("FROM vendor_engagements WHERE id = $1 AND organization_id = $2");
    expect(source).toContain("JOIN frameworks f ON f.id = r.framework_id\n        WHERE f.organization_id = $1");
  });
});

// ---------------------------------------------------------------------------
// The consumer census — what keeps the flag's coverage true over time.
// ---------------------------------------------------------------------------

describe("the set of modules that touch requirements.scope_tags stays closed", () => {
  const engineSrc = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules" || entry === "_frozen_prod") continue;
        sourceFiles(full, acc);
      } else if (entry.endsWith(".ts")) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("is exactly the writers on the frameworks spine plus the flag-gated reader", () => {
    const touching = sourceFiles(engineSrc)
      .filter((f) => readFileSync(f, "utf8").includes("scope_tags"))
      .map((f) => relative(engineSrc, f).split("\\").join("/"))
      .sort();

    expect(touching).toEqual([
      // VA-Q1 P2 (ADR-0013). A READER that labels a bridge question's domain
      // from the requirement's tags (domainForScopeTags — VA-Q0 §5). It scopes
      // nothing and is reached only through resolveScope, which sits behind
      // vendorAssuranceFeatureFlag (above). The domain it derives is inert
      // content until Q2 gives it a consumer — and that consumer will be the
      // resolver, inside the flag.
      // VA-Q1 P3: bridgeAll reads scope_tags for the same domain label, and
      // is reached only through scripts/va-q1-bridge-all.ts (operator) and the
      // premium coverage route, whose SQL does not read scope_tags at all.
      "api/lib/questionnaire/bridgeAll.ts",
      "api/lib/questionnaire/bridgeQuestions.ts",
      // The vocabulary + heuristic themselves — no I/O.
      "api/lib/requirementValidation.ts",
      // VA-Q2 P3.1: the curated reference data for the shipped regulatory /
      // AI templates, plus resolveScopeTags (curated -> heuristic ->
      // uncurated). PURE — a frozen map and two lookups, no I/O and no flag.
      // It joins the census on the frameworks-spine side, not the flag side:
      // its consumers are the two WRITERS below, which VA-6 ruled are premium
      // + org-admin rather than flag-gated. It reaches the resolver only the
      // way any tag does, through the rows those writers persist.
      // Assessment Composition v1: the lazy, idempotent WRITER that provisions
      // the Core Assurance Set into a tenant's library at composition — the
      // same INSERT shape as frameworkActivation.ts, reached only through
      // resolveScope (flag-gated) and never by a vendor.
      "api/lib/vendorRisk/coreAssuranceProvisioning.ts",
      "api/lib/vendorRisk/curatedFrameworkTags.ts",
      "api/lib/vendorRisk/methodologyVersion.ts",
      // VA-Q2 P1: the promoted requirement→domain rule (pure; the reader the
      // Q1 comment above foresaw). Consumed by the resolver, inside the flag.
      "api/lib/vendorRisk/requirementDomain.ts",
      "api/lib/vendorRisk/requirementScopeTags.ts",
      // The resolver: pure, and reached only through vendorEngagements.
      "api/lib/vendorRisk/scopeResolver.ts",
      // WRITERS — frameworks spine, premium + org-admin, not flag-gated by design.
      "api/routes/frameworkActivation.ts",
      "api/routes/requirements.ts",
      // THE ONLY CONSUMER — every route in this file is flag-gated first.
      "api/routes/vendorEngagements.ts",
    ]);
  });

  it("the only consumer imports the flag it is gated by", () => {
    const consumer = readFileSync(join(engineSrc, "api/routes/vendorEngagements.ts"), "utf8");
    expect(consumer).toContain(
      'import { vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js"'
    );
  });

  it("neither VA-6 writer imports a feature flag — the omission is deliberate, not forgotten", () => {
    // If a future package decides these SHOULD be flag-gated, this expectation
    // is the place that records the current ruling and forces the change to be
    // argued rather than drifted into.
    for (const writer of ["api/routes/requirements.ts", "api/routes/frameworkActivation.ts"]) {
      const source = readFileSync(join(engineSrc, writer), "utf8");
      expect(source, `${writer} gained a feature flag — re-read the VA-6 ruling`).not.toMatch(
        /FeatureFlag\b/
      );
    }
  });
});
