/**
 * evidenceLifecycleFlagOff.test.ts — the dark-surface guarantee for the VA-S4
 * governed evidence writer, modelled on c4FlagOff.test.ts.
 *
 * With SECURELOGIC_EVIDENCE_LIFECYCLE_V2 absent or not exactly "true", all eight
 * routes in evidenceLifecycle.ts MUST be a BARE 404 — not 401, not 403, not an
 * empty list, which would each tell a prober the route is real and they merely
 * lack something.
 *
 * This is a REGRESSION test for a real production finding (2026-09-02). The
 * route file placed `requireLifecycleV2` LAST in its middleware GATE, so an
 * anonymous caller was answered by `requireApiKey` with 401 and a Contributor
 * by `denyContributor()` with 403; only a fully authenticated, entitled,
 * non-Contributor caller ever saw the 404 the file's own comment promised.
 * Measured on production: all eight paths returned 401 api_key_required.
 *
 * The fix is ordering, so the guard is an ordering test: assert the status is
 * 404 for an UNAUTHENTICATED request, which can only hold if the flag check
 * precedes authentication.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

// The router imports the pg pool at module load, which throws without
// DATABASE_URL. No route under test ever reaches a query — the flag guard
// answers first, which is the whole point — so a bare stub is honest here and
// keeps this a pure unit test that runs in CI with no database.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  pgElevated: { query: vi.fn(), connect: vi.fn() },
}));

import evidenceLifecycleRouter from "../routes/evidenceLifecycle.js";
import { evidenceLifecycleV2Enabled } from "../lib/evidenceLifecycleFlag.js";

const FLAG = "SECURELOGIC_EVIDENCE_LIFECYCLE_V2";
const ORIGINAL = process.env[FLAG];

const ROUTE_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/api/routes/evidenceLifecycle.ts"),
  "utf8"
);

beforeEach(() => { delete process.env[FLAG]; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[FLAG];
  else process.env[FLAG] = ORIGINAL;
});

/** A bare app: no auth, no org context — exactly an anonymous prober. */
function darkApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", evidenceLifecycleRouter);
  // A distinguishable terminal 404 so we can tell "router declined" from
  // "no such route" if this test ever regresses in the other direction.
  app.use((_req, res) => { res.status(404).json({ error: "no_route_at_all" }); });
  return app;
}

const ID = "11111111-1111-1111-1111-111111111111";

/** Every route the file mounts. Kept explicit so a new route must be added here. */
const ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["post", `/api/evidence/${ID}/links`],
  ["get", `/api/evidence/${ID}/links`],
  ["post", `/api/evidence/links/${ID}/confirm`],
  ["post", `/api/evidence/links/${ID}/detach`],
  ["post", `/api/evidence/${ID}/assurance`],
  ["post", `/api/evidence/${ID}/withdraw`],
  ["get", `/api/organization/evidence-validity-settings`],
  ["put", `/api/organization/evidence-validity-settings/soc1`],
];

describe("the flag is OFF by default", () => {
  it("unset means off", () => {
    expect(evidenceLifecycleV2Enabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("only the exact string 'true' turns it on — no truthy coercion", () => {
    for (const v of ["TRUE", "True", "1", "yes", "on", " true", "true "]) {
      expect(evidenceLifecycleV2Enabled({ [FLAG]: v } as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(evidenceLifecycleV2Enabled({ [FLAG]: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("flag off: the governed evidence surface does not exist", () => {
  it("the flag guard precedes authentication in the GATE", () => {
    const gate = /const GATE = \[([^\]]+)\]/.exec(ROUTE_SRC)?.[1] ?? "";
    expect(gate).not.toBe("");
    const flagAt = gate.indexOf("requireLifecycleV2");
    const authAt = gate.indexOf("requireApiKey");
    expect(flagAt).toBeGreaterThanOrEqual(0);
    expect(authAt).toBeGreaterThanOrEqual(0);
    // The whole guarantee in one assertion: a 403/401 from a later middleware
    // can never be reached while the surface is dark.
    expect(flagAt).toBeLessThan(authAt);
  });

  for (const [method, routePath] of ROUTES) {
    it(`${method.toUpperCase()} ${routePath} is 404 — ABSENT, not merely forbidden`, async () => {
      const res = await (request(darkApp()) as never as Record<string, (p: string) => {
        send: (b: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
      }>)[method]!(routePath).send({});
      expect(res.status).toBe(404);
      // Never the shapes that admit the route is real.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.body["error"]).not.toBe("api_key_required");
    });
  }

  it("leaks no resource-state distinction: valid, unknown and malformed ids are indistinguishable", async () => {
    const app = darkApp();
    const bodies: string[] = [];
    for (const id of [ID, "99999999-9999-9999-9999-999999999999", "not-a-uuid"]) {
      const res = await request(app).get(`/api/evidence/${id}/links`);
      expect(res.status).toBe(404);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("the 404 comes from the flag guard, not from a missing route", async () => {
    // With the flag ON the same path must NOT be 404 — proving the 404 above is
    // the FLAG and not a typo in the path (the c4FlagOff pattern).
    process.env[FLAG] = "true";
    const res = await request(darkApp()).get(`/api/evidence/${ID}/links`);
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401); // reaches requireApiKey — the route is real
  });
});
