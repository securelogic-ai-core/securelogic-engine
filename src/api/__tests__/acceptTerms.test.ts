/**
 * acceptTerms.test.ts — integration tests for POST /api/auth/accept-terms.
 *
 * Drives the real customerAuth router via supertest. requireAuth's JWT
 * verification is mocked (verifyJwt), and the postgres pool is mocked: the
 * prior-consent SELECT is controllable per test and every legal_consents INSERT
 * is captured. getMissingConsents/recordConsent run for real against the mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => {
  const state = { priorRows: [] as any[] };
  const consentInserts: any[][] = [];
  const elevatedQuery = vi.fn(async (sql: string, params?: any[]) => {
    if (/INSERT INTO legal_consents/.test(sql)) {
      consentInserts.push(params ?? []);
      return { rows: [] };
    }
    if (/SELECT id FROM legal_consents/.test(sql)) {
      return { rows: state.priorRows };
    }
    return { rows: [] };
  });
  return { state, consentInserts, elevatedQuery };
});

vi.mock("express-rate-limit", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../infra/postgres.js", () => ({
  // requireAuth's password_changed_at lookup → no invalidation.
  pg: { query: vi.fn(async () => ({ rows: [{ password_changed_at: null }] })) },
  pgElevated: { query: h.elevatedQuery, connect: vi.fn() },
}));
vi.mock("../lib/jwt.js", () => ({
  verifyJwt: vi.fn(() => ({ sub: USER, org: ORG, role: "admin", iat: 0, exp: 9_999_999_999 })),
  signJwt: vi.fn(() => "signed.jwt.token"),
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
import { verifyJwt } from "../lib/jwt.js";

const mockVerify = verifyJwt as unknown as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", customerAuthRouter);
  return app;
}

beforeEach(() => {
  h.consentInserts.length = 0;
  h.state.priorRows = [];
  h.elevatedQuery.mockClear();
  mockVerify.mockReturnValue({ sub: USER, org: ORG, role: "admin", iat: 0, exp: 9_999_999_999 });
});

describe("POST /api/auth/accept-terms", () => {
  it("returns 401 when unauthenticated (no bearer token)", async () => {
    const res = await request(makeApp()).post("/api/auth/accept-terms").send({});
    expect(res.status).toBe(401);
    expect(h.consentInserts).toHaveLength(0);
  });

  it("records all three consents for a first-login user (sso interstitial method)", async () => {
    h.state.priorRows = []; // no prior consents
    const res = await request(makeApp())
      .post("/api/auth/accept-terms")
      .set("Authorization", "Bearer a.b.c")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.recordedConsents).toHaveLength(3);
    expect(h.consentInserts).toHaveLength(3);
    for (const params of h.consentInserts) {
      expect(params[0]).toBe(USER);
      expect(params[1]).toBe(ORG);
      expect(params[4]).toBe("sso_first_login_interstitial");
    }
  });

  it("uses re_consent_dialog method when the user already has consent history", async () => {
    h.state.priorRows = [{ id: "some-existing-consent" }];
    const res = await request(makeApp())
      .post("/api/auth/accept-terms")
      .set("Authorization", "Bearer a.b.c")
      .send({});

    expect(res.status).toBe(200);
    expect(h.consentInserts).toHaveLength(3);
    for (const params of h.consentInserts) {
      expect(params[4]).toBe("re_consent_dialog");
    }
  });

  it("respects acceptedDocuments when provided", async () => {
    const res = await request(makeApp())
      .post("/api/auth/accept-terms")
      .set("Authorization", "Bearer a.b.c")
      .send({ acceptedDocuments: ["terms_of_service"] });

    expect(res.status).toBe(200);
    expect(res.body.recordedConsents).toHaveLength(1);
    expect(h.consentInserts).toHaveLength(1);
    expect(h.consentInserts[0]![2]).toBe("terms_of_service");
  });

  it("rejects an unknown document type (400)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/accept-terms")
      .set("Authorization", "Bearer a.b.c")
      .send({ acceptedDocuments: ["not_a_real_doc"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_document_type");
    expect(h.consentInserts).toHaveLength(0);
  });

  it("is idempotent — accepting when all consents already present still returns 200", async () => {
    // ON CONFLICT DO NOTHING is enforced at the DB; the handler still issues the
    // inserts and must not error.
    h.state.priorRows = [{ id: "existing" }];
    const res = await request(makeApp())
      .post("/api/auth/accept-terms")
      .set("Authorization", "Bearer a.b.c")
      .send({});
    expect(res.status).toBe(200);
    expect(h.consentInserts).toHaveLength(3);
  });
});
