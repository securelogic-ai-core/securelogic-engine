/**
 * Seat metering (#9) — companion to entityLimit.test.ts.
 *
 * Behavioral coverage of the active-member count vs the per-org `max_members`
 * cap in `enforceSeatLimit`, plus source-asserts pinning the SSO JIT
 * enforcement (the bypass this closes), the surviving team-invite enforcement,
 * and the admin-set seat-cap operator path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// pg is mocked for the behavioral section; the helper issues a single query.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockQuery }
}));

import { enforceSeatLimit, DEFAULT_MAX_SEATS } from "../lib/seatLimit.js";

const ORG = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// 1. Behavioral — active-member count vs cap.
// ---------------------------------------------------------------------------
describe("enforceSeatLimit — active-member count vs cap", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("at limit (count == cap) → exceeded (drives the rejection)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "6", cap: 6 }] });
    const r = await enforceSeatLimit(ORG);
    expect(r).toEqual({ exceeded: true, used: 6, cap: 6 });
  });

  it("under limit → not exceeded (provisioning proceeds)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "5", cap: 6 }] });
    const r = await enforceSeatLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 5, cap: 6 });
  });

  it("counts only status='active' users against max_members", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "5", cap: 10 }] });
    await enforceSeatLimit(ORG);
    const sql = String(mockQuery.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/COUNT\(\*\)\s+FROM users/);
    expect(sql).toMatch(/status\s*=\s*'active'/);
    expect(sql).toMatch(/o\.max_members/);
    // org id is the only bind parameter
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([ORG]);
  });

  it("admin-raised cap → previously-blocked count now allowed", async () => {
    // Same 10 members, but the operator raised the cap to 50 (Platform/Enterprise).
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "10", cap: 50 }] });
    const r = await enforceSeatLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 10, cap: 50 });
  });

  it("missing org row → defaults to cap 6, used 0, not exceeded", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await enforceSeatLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 0, cap: DEFAULT_MAX_SEATS });
  });

  it("null cap (legacy row) → defaults to 6", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "3", cap: null }] });
    const r = await enforceSeatLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 3, cap: DEFAULT_MAX_SEATS });
  });
});

// ---------------------------------------------------------------------------
// 2. Wiring — SSO JIT enforces the cap before INSERT (the closed bypass).
// ---------------------------------------------------------------------------
const SSO_SRC = readFileSync(resolve(__dirname, "../routes/sso.ts"), "utf8");

describe("seat-limit wiring — SSO JIT provisioning (#9a)", () => {
  it("imports and calls enforceSeatLimit", () => {
    expect(SSO_SRC).toMatch(/import \{ enforceSeatLimit \} from "\.\.\/lib\/seatLimit\.js"/);
    expect(SSO_SRC).toMatch(/enforceSeatLimit\(orgId\)/);
  });

  it("redirects with seat_limit_reached when exceeded", () => {
    expect(SSO_SRC).toMatch(/seat\.exceeded/);
    expect(SSO_SRC).toMatch(/login\?error=seat_limit_reached/);
  });

  it("checks the cap BEFORE the JIT INSERT INTO users", () => {
    const enforceIdx = SSO_SRC.indexOf("enforceSeatLimit(orgId)");
    const insertIdx = SSO_SRC.search(/INSERT INTO users/);
    expect(enforceIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(enforceIdx);
  });
});

// ---------------------------------------------------------------------------
// 3. The team-invite enforcement path still rejects at the cap (unchanged).
// ---------------------------------------------------------------------------
const INVITES_SRC = readFileSync(resolve(__dirname, "../routes/teamInvites.ts"), "utf8");

describe("seat-limit wiring — team-invite path (regression guard)", () => {
  it("still returns 409 seat_limit_reached when seats are full", () => {
    expect(INVITES_SRC).toMatch(/usedSeats >= maxSeats/);
    expect(INVITES_SRC).toMatch(/status\(409\)[\s\S]{0,120}seat_limit_reached/);
  });
});

// ---------------------------------------------------------------------------
// 4. Admin-set seat cap (sales-led operator path, #9b).
// ---------------------------------------------------------------------------
const ADMIN_SRC = readFileSync(resolve(__dirname, "../routes/adminOrganizations.ts"), "utf8");

describe("adminOrganizations — operator can set max_members", () => {
  it("parses and validates max_members as a non-negative integer", () => {
    expect(ADMIN_SRC).toMatch(/req\.body\?\.max_members/);
    expect(ADMIN_SRC).toMatch(/invalid_max_members/);
  });

  it("writes max_members via COALESCE in the UPDATE and RETURNs it", () => {
    expect(ADMIN_SRC).toMatch(/max_members\s*=\s*COALESCE\(\$9, max_members\)/);
    expect(ADMIN_SRC).toMatch(/RETURNING[\s\S]{0,200}max_members/);
  });

  it("does NOT auto-raise max_members in the Stripe webhook (no self-serve tier exceeds 6 seats)", () => {
    const WEBHOOK_SRC = readFileSync(resolve(__dirname, "../webhooks/stripeWebhook.ts"), "utf8");
    expect(WEBHOOK_SRC).not.toMatch(/max_members\s*=/);
  });
});
