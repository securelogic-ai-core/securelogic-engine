/**
 * customerAuthSignup.test.ts — integration tests for POST /api/auth/signup,
 * focused on the legal-consent requirement.
 *
 * Drives the real customerAuth router through supertest with the postgres pool
 * and email/audit side-effects mocked. The signup transaction client is a
 * vi.fn-backed fake that records every legal_consents INSERT so we can assert
 * the three consent rows are written with the correct values.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

// Shared mock state, created in the hoisted scope so the vi.mock factory below
// can close over it.
const h = vi.hoisted(() => {
  const consentInserts: { sql: string; params: any[] }[] = [];
  const clientCalls: string[] = [];
  const fakeClient = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      clientCalls.push(sql);
      if (/INSERT INTO legal_consents/.test(sql)) {
        consentInserts.push({ sql, params: params ?? [] });
        return { rows: [] };
      }
      if (/INSERT INTO organizations/.test(sql)) return { rows: [{ id: ORG }] };
      if (/INSERT INTO users/.test(sql)) return { rows: [{ id: USER }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { consentInserts, clientCalls, fakeClient };
});

vi.mock("express-rate-limit", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [] })) }, // existing-email check → none
  pgElevated: { connect: vi.fn(async () => h.fakeClient), query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/sentry.js", () => ({ captureException: vi.fn() }));
vi.mock("../lib/authAnomaly.js", () => ({ recordAccountLockout: vi.fn() }));
vi.mock("../lib/passwordHistory.js", () => ({
  checkPasswordReuse: vi.fn(async () => false),
  recordPasswordHash: vi.fn(async () => {}),
}));

import express from "express";
import request from "supertest";
import customerAuthRouter from "../routes/customerAuth.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", customerAuthRouter);
  return app;
}

const VALID_BODY = {
  organizationName: "Acme Inc",
  name: "Alice Admin",
  email: "alice@example.com",
  password: "Password1234",
};

beforeEach(() => {
  h.consentInserts.length = 0;
  h.clientCalls.length = 0;
  h.fakeClient.query.mockClear();
});

describe("POST /api/auth/signup — legal consent", () => {
  it("rejects signup with missing acceptedTerms (400)", async () => {
    const res = await request(makeApp()).post("/api/auth/signup").send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_terms_acceptance");
    expect(h.consentInserts).toHaveLength(0);
    // Transaction must not have started.
    expect(h.clientCalls).toHaveLength(0);
  });

  it("rejects signup with acceptedTerms: false (400)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/signup")
      .send({ ...VALID_BODY, acceptedTerms: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_terms_acceptance");
    expect(h.consentInserts).toHaveLength(0);
  });

  it("rejects acceptedTerms that is a truthy non-boolean (400)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/signup")
      .send({ ...VALID_BODY, acceptedTerms: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_terms_acceptance");
  });

  it("accepts signup with acceptedTerms: true and writes three consent rows", async () => {
    const res = await request(makeApp())
      .post("/api/auth/signup")
      .set("User-Agent", "vitest-agent")
      .send({ ...VALID_BODY, acceptedTerms: true });

    expect(res.status).toBe(201);
    expect(h.consentInserts).toHaveLength(3);

    const byType = new Map(h.consentInserts.map((c) => [c.params[2], c.params]));
    expect([...byType.keys()].sort()).toEqual(
      ["ai_transparency_policy", "privacy_policy", "terms_of_service"]
    );

    for (const [, params] of byType) {
      expect(params[0]).toBe(USER); // user_id
      expect(params[1]).toBe(ORG); // organization_id
      expect(params[3]).toBe("1.0"); // document_version
      expect(params[4]).toBe("signup_checkbox"); // consent_method
      expect(params[6]).toBe("vitest-agent"); // user_agent
      // ip_address is captured from req.ip — string or null, never undefined.
      expect(params[5] === null || typeof params[5] === "string").toBe(true);
    }
  });

  it("writes consent rows inside the transaction (before COMMIT)", async () => {
    await request(makeApp())
      .post("/api/auth/signup")
      .send({ ...VALID_BODY, acceptedTerms: true });

    const firstConsentIdx = h.clientCalls.findIndex((s) => /INSERT INTO legal_consents/.test(s));
    const commitIdx = h.clientCalls.findIndex((s) => /COMMIT/.test(s));
    expect(firstConsentIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(firstConsentIdx).toBeLessThan(commitIdx);
  });
});
