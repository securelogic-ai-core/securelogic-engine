/**
 * findingProvenanceActivationBoundary.test.ts — T1-B (#861).
 *
 * T1-B renders inside the Decision Workspace, so the natural assumption is that
 * it lives behind SECURELOGIC_DECISION_WORKSPACE_ENABLED. It does not, and the
 * omission is a decision rather than an oversight:
 *
 *   ADR-0010 Option 4 (RATIFIED 2026-08-22) requires that "Findings must
 *   preserve sufficient provenance for a user to navigate back to the
 *   originating vendor / document / CUEC". The Decision Workspace flag is
 *   `false` in production (verified live 2026-08-27 on both the prod engine and
 *   the prod app). Putting provenance behind it would mean the ratified
 *   capability never reaches the environment that has customers — and the
 *   advertised Findings workflow is the STANDARD layout, not the Workspace.
 *
 *   `GET /findings/:id/context` IS behind that flag, which is exactly why
 *   provenance could not live there.
 *
 * So the boundary this file pins is the real one: T1-B rides with its two
 * sibling finding-detail panels (`findingRiskLinks`, `findingAssetOccurrences`),
 * carries their guard set verbatim, and is therefore governed by ENTITLEMENT and
 * SEAT rather than by a feature flag. The three activate together; none of them
 * can surprise someone by activating alone.
 *
 * The cross-tenant proofs live in test/isolation/findingVendorProvenanceRls.test.ts
 * against real Postgres. What is proven HERE is what that file cannot see: that
 * the route's answer does not move when the Decision Workspace flag moves.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const FINDING = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

let entitled = true;

/**
 * The handler issues two reads: the same-org finding existence check, then the
 * CUEC join. Sequencing them gives the "vendor_review finding with no CUEC row"
 * case — the `vendor_assessment` answer — which is the one that exercises the
 * full path without needing a fabricated provenance payload.
 */
let call = 0;
const query = vi.fn(async () =>
  ++call === 1
    ? { rows: [{ source_type: "vendor_review" }], rowCount: 1 }
    : { rows: [], rowCount: 0 }
);

vi.mock("../infra/postgres.js", () => ({
  pg: { query: () => query() },
  pgElevated: { query: () => query() },
  withTenant: (_o: string, f: () => unknown) => f(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: express.Request, _r: express.Response, n: express.NextFunction) => {
    (req as never as Record<string, unknown>).apiKey = { id: "k-1" };
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

import vendorProvenanceRouter from "../routes/findingVendorProvenance.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", vendorProvenanceRouter);
  a.use((req, res) => res.status(404).json({ error: "not_found", path: req.path }));
  return a;
}

const ROUTE = `/api/findings/${FINDING}/vendor-provenance`;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  call = 0;
  entitled = true;
  delete process.env["SECURELOGIC_DECISION_WORKSPACE_ENABLED"];
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------------------------------------------------------------------------
// The flag does not move the answer — in either direction.
// ---------------------------------------------------------------------------

describe("provenance is INDEPENDENT of the Decision Workspace flag", () => {
  it.each([
    ["absent (production today)", undefined],
    ["explicitly false", "false"],
    ["true (staging today)", "true"],
  ])("answers identically with the flag %s", async (_label, value) => {
    if (value === undefined) delete process.env["SECURELOGIC_DECISION_WORKSPACE_ENABLED"];
    else process.env["SECURELOGIC_DECISION_WORKSPACE_ENABLED"] = value;

    const res = await request(app()).get(ROUTE);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("vendor_assessment");
    expect(res.body.finding_id).toBe(FINDING);
  });

  it("is never dark — flag off is a 200, not the flag-404 shape", async () => {
    process.env["SECURELOGIC_DECISION_WORKSPACE_ENABLED"] = "false";
    const res = await request(app()).get(ROUTE);
    expect(res.status).toBe(200);
    expect(res.body).not.toEqual({ error: "not_found" });
  });

  it("a route MISS still looks different from anything this router answers", async () => {
    const miss = await request(app()).get(`/api/findings/${FINDING}/no-such-panel`);
    expect(miss.status).toBe(404);
    expect(miss.body).toHaveProperty("path");
  });
});

// ---------------------------------------------------------------------------
// What DOES govern it: entitlement and seat.
// ---------------------------------------------------------------------------

describe("entitlement is the control that actually governs T1-B", () => {
  it("refuses without the premium entitlement, flag or no flag", async () => {
    entitled = false;
    for (const v of ["false", "true"]) {
      call = 0;
      process.env["SECURELOGIC_DECISION_WORKSPACE_ENABLED"] = v;
      const res = await request(app()).get(ROUTE);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "insufficient_entitlement" });
    }
  });

  it("runs NO database work when the entitlement refuses", async () => {
    entitled = false;
    await request(app()).get(ROUTE);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a malformed finding id before touching the database", async () => {
    const res = await request(app()).get(`/api/findings/not-a-uuid/vendor-provenance`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_finding_id" });
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The three finding-detail panels activate together, or the claim above is void.
// ---------------------------------------------------------------------------

describe("T1-B carries the guard set of its two siblings, verbatim", () => {
  const routesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../routes");
  const PANELS = [
    "findingVendorProvenance.ts",
    "findingRiskLinks.ts",
    "findingAssetOccurrences.ts",
  ] as const;

  it("every panel route begins requireApiKey -> attachOrganizationContext -> 3 more", async () => {
    // The entitlement and seat guards are anonymous closures, so parity is
    // asserted by SHAPE plus the source check below — together they are the
    // claim "same guards, same order, same count".
    type Layer = { route?: { path: string; stack: Array<{ handle: { name: string } }> } };
    const mods = await Promise.all([
      import("../routes/findingVendorProvenance.js"),
      import("../routes/findingRiskLinks.js"),
      import("../routes/findingAssetOccurrences.js"),
    ]);
    for (const mod of mods) {
      const layers = (mod.default as unknown as { stack: Layer[] }).stack.filter((l) => l.route);
      expect(layers.length).toBeGreaterThan(0);
      for (const l of layers) {
        const names = l.route!.stack.map((h) => h.handle.name || "<anon>");
        expect(names.slice(0, 2)).toEqual(["requireApiKey", "attachOrganizationContext"]);
        expect(names).toHaveLength(5);
      }
    }
  });

  it("NONE of the three imports a feature flag — they are entitlement-gated by design", () => {
    // If a later package decides provenance SHOULD be flag-gated, this is the
    // expectation that makes the change deliberate instead of silent. Read the
    // ADR-0010 Option 4 reasoning at the top of this file first.
    for (const f of PANELS) {
      const src = readFileSync(join(routesDir, f), "utf8");
      expect(src, `${f} gained a feature-flag import`).not.toMatch(
        /^import\s+\{[^}]*FeatureFlag[^}]*\}/m
      );
      expect(src).toContain('import { requireEntitlement } from "../middleware/requireEntitlement.js"');
      expect(src).toContain('import { denyContributor } from "../middleware/requireSeat.js"');
    }
  });

  it("the flag-gated neighbour is still flag-gated — /findings/:id/context has not moved", () => {
    // The reason provenance could not live there. If this ever stops being true,
    // the design rationale above needs re-reading, not silently inheriting.
    const findings = readFileSync(join(routesDir, "findings.ts"), "utf8");
    expect(findings).toMatch(
      /SECURELOGIC_DECISION_WORKSPACE_ENABLED\s*!==\s*"true"/
    );
  });
});
