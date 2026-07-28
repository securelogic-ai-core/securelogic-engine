import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  pgElevated: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pgElevated } from "../infra/postgres.js";
import {
  ssoCodeExchangeEnabled,
  createSsoLoginCode,
  consumeSsoLoginCode,
  SSO_LOGIN_CODE_TTL_SECONDS,
} from "../lib/ssoLoginCodes.js";

const query = pgElevated.query as unknown as ReturnType<typeof vi.fn>;

const FLAG = "SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED";

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("ssoCodeExchangeEnabled — dark by default", () => {
  it("only the literal string 'true' enables", () => {
    expect(ssoCodeExchangeEnabled()).toBe(false);
    process.env[FLAG] = "1";
    expect(ssoCodeExchangeEnabled()).toBe(false);
    process.env[FLAG] = "true";
    expect(ssoCodeExchangeEnabled()).toBe(true);
  });
});

describe("createSsoLoginCode", () => {
  it("returns a 64-hex raw code and stores ONLY its sha256 — the raw code never reaches the DB", async () => {
    const raw = await createSsoLoginCode({
      organizationId: "org-1",
      userId: "user-1",
      email: "a@b.test",
      displayName: "Ada",
    });

    expect(raw).toMatch(/^[0-9a-f]{64}$/);

    const insertParams = query.mock.calls[0][1] as unknown[];
    const expectedHash = crypto.createHash("sha256").update(raw).digest("hex");
    expect(insertParams).toContain(expectedHash);
    expect(insertParams).not.toContain(raw);
    expect(insertParams).toContain(SSO_LOGIN_CODE_TTL_SECONDS);
    // No SQL statement anywhere carries the raw code either.
    for (const call of query.mock.calls) {
      expect(String(call[0])).not.toContain(raw);
    }
  });

  it("two codes are never equal (256-bit random)", async () => {
    const input = { organizationId: "o", userId: "u", email: "e@x.test", displayName: "N" };
    const a = await createSsoLoginCode(input);
    const b = await createSsoLoginCode(input);
    expect(a).not.toBe(b);
  });
});

describe("consumeSsoLoginCode", () => {
  it("rejects malformed input WITHOUT touching the database", async () => {
    for (const bad of ["", "short", "Z".repeat(64), "0".repeat(63), null, undefined, 42]) {
      expect(await consumeSsoLoginCode(bad as unknown as string)).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("consumes via one atomic claim UPDATE and maps the payload", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          organization_id: "org-1",
          user_id: "user-1",
          email: "a@b.test",
          display_name: "Ada",
        },
      ],
      rowCount: 1,
    });

    const raw = "a".repeat(64);
    const payload = await consumeSsoLoginCode(raw);

    expect(payload).toEqual({
      organizationId: "org-1",
      userId: "user-1",
      email: "a@b.test",
      displayName: "Ada",
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("consumed_at IS NULL");
    expect(sql).toContain("expires_at > NOW()");
    expect(sql).toContain("SET consumed_at = NOW()");
  });

  it("unknown / expired / replayed all resolve to the same null", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await consumeSsoLoginCode("b".repeat(64))).toBeNull();
  });
});
