/**
 * requireConsentMiddleware.test.ts — unit tests for the requireConsent gate.
 *
 * The middleware self-extracts the JWT from the Authorization/X-Api-Key header,
 * looks up missing consents via getMissingConsents(pgElevated, ...), and either
 * passes through (next) or returns 403 consent_required. JWT verification and
 * the postgres pool are mocked; getMissingConsents runs for real against the
 * mocked pool so the version-matching logic is exercised end to end.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: vi.fn() },
}));
vi.mock("../lib/jwt.js", () => ({
  verifyJwt: vi.fn(),
}));

import { pgElevated } from "../infra/postgres.js";
import { verifyJwt } from "../lib/jwt.js";
import { requireConsent } from "../middleware/requireConsent.js";
import { CURRENT_VERSIONS, DOCUMENT_TYPES } from "../lib/legalConsent.js";

const mockQuery = pgElevated.query as unknown as ReturnType<typeof vi.fn>;
const mockVerify = verifyJwt as unknown as ReturnType<typeof vi.fn>;

const USER = "11111111-1111-4111-8111-111111111111";

function makeReq(headerValue?: string) {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? headerValue : undefined),
    headers: {},
  } as any;
}

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function consentRows(versions: Partial<Record<string, string>>) {
  return Object.entries(versions).map(([document_type, document_version]) => ({
    document_type,
    document_version,
  }));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockVerify.mockReset();
});

describe("requireConsent", () => {
  it("passes through a user with all current consents", async () => {
    mockVerify.mockReturnValue({ sub: USER });
    mockQuery.mockResolvedValue({
      rows: consentRows({
        terms_of_service: CURRENT_VERSIONS.terms_of_service,
        privacy_policy: CURRENT_VERSIONS.privacy_policy,
        ai_transparency_policy: CURRENT_VERSIONS.ai_transparency_policy,
      }),
    });
    const req = makeReq("Bearer a.b.c");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 consent_required listing the one missing document", async () => {
    mockVerify.mockReturnValue({ sub: USER });
    mockQuery.mockResolvedValue({
      rows: consentRows({
        terms_of_service: CURRENT_VERSIONS.terms_of_service,
        ai_transparency_policy: CURRENT_VERSIONS.ai_transparency_policy,
      }),
    });
    const req = makeReq("Bearer a.b.c");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0]![0];
    expect(body.error).toBe("consent_required");
    expect(body.missingDocuments).toEqual(["privacy_policy"]);
  });

  it("returns 403 with all documents when the user has none", async () => {
    mockVerify.mockReturnValue({ sub: USER });
    mockQuery.mockResolvedValue({ rows: [] });
    const req = makeReq("Bearer a.b.c");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0]![0].missingDocuments).toEqual([...DOCUMENT_TYPES]);
  });

  it("treats an old-version consent as missing", async () => {
    mockVerify.mockReturnValue({ sub: USER });
    mockQuery.mockResolvedValue({
      rows: consentRows({
        terms_of_service: "0.9",
        privacy_policy: CURRENT_VERSIONS.privacy_policy,
        ai_transparency_policy: CURRENT_VERSIONS.ai_transparency_policy,
      }),
    });
    const req = makeReq("Bearer a.b.c");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0]![0].missingDocuments).toEqual(["terms_of_service"]);
  });

  it("fails open (next, no 403) when the consent lookup throws", async () => {
    mockVerify.mockReturnValue({ sub: USER });
    mockQuery.mockRejectedValue(new Error("db unreachable"));
    const req = makeReq("Bearer a.b.c");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through a raw machine API key (no JWT) without querying consents", async () => {
    const req = makeReq("sl_deadbeefdeadbeefdeadbeefdeadbeef");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("passes through (defers to auth guard) when the JWT is invalid", async () => {
    mockVerify.mockReturnValue(null);
    const req = makeReq("Bearer a.b.c");
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("passes through when no credential is presented", async () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();
    await requireConsent(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
