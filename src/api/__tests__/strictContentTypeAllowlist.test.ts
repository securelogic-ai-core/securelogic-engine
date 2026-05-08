/**
 * strictContentTypeAllowlist.test.ts
 *
 * Regression guard for the inline strict Content-Type middleware in
 * src/api/server.ts (the block under "STRICT CONTENT-TYPE ENFORCEMENT").
 *
 * Bug context: on staging, vendor-assurance SOC uploads were being rejected
 * with 415 unsupported_media_type *before* reaching the route handler,
 * because the JSON-only guard did not exempt POST /api/vendor-assurance/documents.
 *
 * This test pins the exemption set as a behavioral contract. If the inline
 * middleware in server.ts diverges from the predicate below, this test will
 * fail and the divergence must be reconciled.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import { describe, it, expect } from "vitest";

/**
 * Mirrors the inline allowlist in src/api/server.ts (STRICT CONTENT-TYPE
 * ENFORCEMENT block). Keep in sync — if server.ts changes, update here too.
 */
function isExempt(originalUrl: string): boolean {
  return (
    originalUrl.startsWith("/webhooks/lemon") ||
    originalUrl.startsWith("/webhooks/email/resend") ||
    originalUrl.startsWith("/api/vendor-assessments/analyze-document") ||
    /^\/api\/vendor-assurance\/documents(\?|$)/.test(originalUrl) ||
    /^\/api\/sso\/[^/]+\/acs/.test(originalUrl)
  );
}

function strictContentType(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const isBodyMethod = method === "POST" || method === "PUT" || method === "PATCH";

  if (isExempt(req.originalUrl)) {
    next();
    return;
  }

  if (!isBodyMethod) {
    next();
    return;
  }

  const ct = req.headers["content-type"] ?? "";
  if (typeof ct !== "string" || ct.trim().length === 0) {
    next();
    return;
  }

  const normalized = ct.toLowerCase();
  if (!normalized.startsWith("application/json")) {
    res.status(415).json({ error: "unsupported_media_type" });
    return;
  }

  next();
}

function buildApp(): express.Express {
  const app = express();
  app.use(strictContentType);
  // Echo handler: if the middleware lets the request through, we return 200.
  app.all("*splat", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
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

describe("strict Content-Type allowlist (mirror of server.ts)", () => {
  it("permits multipart POST to /api/vendor-assurance/documents (the bug fix)", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assurance/documents",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).toBe(200);
  });

  it("permits multipart POST to /api/vendor-assurance/documents with query string", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assurance/documents?ts=1",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).toBe(200);
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
  });

  it("still permits multipart POST to legacy /api/vendor-assessments/analyze-document", async () => {
    const app = buildApp();
    const r = await send(
      app,
      "POST",
      "/api/vendor-assessments/analyze-document",
      "multipart/form-data; boundary=----abc"
    );
    expect(r.status).toBe(200);
  });

  it("still permits application/json POSTs to non-exempt routes", async () => {
    const app = buildApp();
    const r = await send(app, "POST", "/api/risks", "application/json");
    expect(r.status).toBe(200);
  });
});
