/**
 * strictContentTypeAllowlist.test.ts
 *
 * Regression guard for the strict Content-Type enforcement middleware
 * (the "STRICT CONTENT-TYPE ENFORCEMENT" block in src/api/app.ts).
 *
 * Bug context: on staging, vendor-assurance SOC uploads were being rejected
 * with 415 unsupported_media_type *before* reaching the route handler,
 * because the JSON-only guard did not exempt POST /api/vendor-assurance/documents.
 *
 * This test drives the REAL application built by createApp() — not a
 * hand-written mirror. It therefore doubles as the behavior-preservation
 * proof for the createApp() extraction (server.ts -> app.ts): the strict
 * Content-Type block is exercised exactly as wired in production. If the
 * extraction changed the middleware's position or logic, this test fails.
 *
 * Postgres is mocked because buildRoutes() eagerly imports the full route
 * graph and infra/postgres.ts throws at import when DATABASE_URL is unset.
 * Requests that PASS the strict Content-Type gate continue through the real
 * middleware chain and reach real authentication, so the contract asserted
 * for permitted routes is "not blocked by strict CT" (status !== 415) — the
 * strict-CT middleware is the only producer of 415 in the chain. Requests
 * that are BLOCKED never reach a route and return 415 unsupported_media_type.
 */
import { describe, it, expect, vi } from "vitest";

// Hoisted above the createApp import below. Stubs the pg Pool so the route
// graph imported by buildRoutes() loads without a database connection.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }
}));

import type express from "express";
import { createApp } from "../app.js";

function buildApp(): express.Express {
  return createApp({ isDev: false, publicApiDisabled: false });
}

async function send(
  app: express.Express,
  method: string,
  url: string,
  contentType: string
): Promise<{ status: number; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no_address"));
        return;
      }
      const port = address.port;
      fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { "Content-Type": contentType },
        body: method === "GET" ? undefined : "x"
      })
        .then(async (r) => {
          const body = await r.json().catch(() => null);
          server.close();
          resolve({ status: r.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("strict Content-Type allowlist (real createApp)", () => {
  it("permits multipart POST to /api/vendor-assurance/documents (the bug fix)", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assurance/documents",
      "multipart/form-data; boundary=----abc"
    );
    // Exempt: the strict-CT gate must let it through. Downstream it hits
    // real auth (no API key -> not a 415).
    expect(r.status).not.toBe(415);
  });

  it("permits multipart POST to /api/vendor-assurance/documents with query string", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assurance/documents?ts=1",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).not.toBe(415);
  });

  it("still blocks multipart POST to /api/vendor-assurance/documents/:id/finalize (JSON-only sub-path)", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assurance/documents/abc-123/finalize",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).toBe(415);
    expect(r.body).toEqual({ error: "unsupported_media_type" });
  });

  it("still blocks multipart POST to a non-exempt JSON route", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/risks",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).toBe(415);
    expect(r.body).toEqual({ error: "unsupported_media_type" });
  });

  it("still permits multipart POST to legacy /api/vendor-assessments/analyze-document", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assessments/analyze-document",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).not.toBe(415);
  });

  it("still permits application/json POSTs to non-exempt routes", async () => {
    const app = buildApp();
    const r = await send(app, "POST", "/api/risks", "application/json");
    expect(r.status).not.toBe(415);
  });
});
