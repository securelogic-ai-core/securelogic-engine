/**
 * questionsRoutesAssembled.test.ts — VA-Q1 P1 through the REAL createApp().
 *
 * The VA-E2E-1 rule: a suite that drives buildRoutes() alone is blind to every
 * createApp() middleware. This one exists so the question library's routes are
 * exercised behind the same gate chain production runs — strict Content-Type,
 * then real auth.
 *
 * Postgres is mocked (buildRoutes imports the full route graph). Requests that
 * pass the gate reach real authentication and fail there with a 401 — the
 * assertion for each permitted shape is therefore "not 415", and for each
 * refused shape "exactly 415". Auth-and-beyond is the isolation suite's job.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: async (_o: string, fn: () => unknown) => fn(),
}));

import type express from "express";
import { createApp } from "../app.js";

function buildApp(): express.Express {
  return createApp({ isDev: false, publicApiDisabled: false });
}

async function send(app: express.Express, method: string, url: string, headers: Record<string, string>, body?: string) {
  return await new Promise<{ status: number; body: unknown }>((resolveP, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("no_address")); return; }
      fetch(`http://127.0.0.1:${address.port}${url}`, { method, headers, body })
        .then(async (r) => { const b = await r.json().catch(() => null); server.close(); resolveP({ status: r.status, body: b }); })
        .catch((e) => { server.close(); reject(e); });
    });
  });
}

const QID = "11111111-1111-1111-1111-111111111111";
const MUTATING: Array<[string, string]> = [
  ["POST", "/api/questions"],
  ["POST", `/api/questions/${QID}/versions`],
  ["PATCH", `/api/questions/${QID}`],
  ["POST", `/api/questions/${QID}/links`],
];

describe("question library routes — assembled app (VA-Q1 P1)", () => {
  it("every mutating route is JSON-only: multipart is 415 at the gate", async () => {
    for (const [method, path] of MUTATING) {
      const app = buildApp();
      const r = await send(app, method, path, { "Content-Type": "multipart/form-data; boundary=----abc" }, "x");
      expect(r.status, `${method} ${path}`).toBe(415);
      expect(r.body, `${method} ${path}`).toEqual({ error: "unsupported_media_type" });
    }
  });

  it("JSON passes the gate and meets real authentication (401, never 415, never 200)", async () => {
    for (const [method, path] of MUTATING) {
      const app = buildApp();
      const r = await send(app, method, path, { "Content-Type": "application/json" }, "{}");
      expect(r.status, `${method} ${path}`).toBe(401);
    }
    const app = buildApp();
    const g = await send(app, "GET", "/api/questions", {});
    expect(g.status).toBe(401);
  });

  it("a vendor-portal session cookie is NOT a credential for the question library", async () => {
    const app = buildApp();
    const r = await send(app, "GET", "/api/questions", { Cookie: "sl_vendor_portal=" + "a".repeat(64) });
    expect(r.status).toBe(401);
  });
});

describe("question library routes — composition pins (source-level)", () => {
  const src = readFileSync(resolve(__dirname, "../routes/questions.ts"), "utf8");

  it("every route is premium-gated, tenant-wrapped, and denies contributor seats", () => {
    const routes = src.match(/router\.(get|post|patch|delete)\(/g) ?? [];
    expect(routes.length).toBe(7);
    expect(src).toMatch(/const readChain = \[requireApiKey, attachOrganizationContext, requireEntitlement\("premium"\), denyContributor\(\)\]/);
    expect((src.match(/asTenant\(/g) ?? []).length).toBe(7);
  });

  it("every mutation requires the admin role; reads do not", () => {
    expect(src).toMatch(/const writeChain = \[\.\.\.readChain, requireAdminRole\]/);
    expect((src.match(/\.\.\.writeChain/g) ?? []).length).toBe(5);
    expect((src.match(/\.\.\.readChain,\n/g) ?? []).length).toBe(2);
  });

  it("there is no route that updates or deletes a version (ADR-0013 R3)", () => {
    expect(src).not.toMatch(/UPDATE question_versions/);
    expect(src).not.toMatch(/DELETE FROM question_versions/);
    expect(src).not.toMatch(/router\.(put|patch|delete)\(\s*"\/questions\/:id\/versions/);
  });
});
