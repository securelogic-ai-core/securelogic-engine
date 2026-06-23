/**
 * Monitored-entity metering (PR 2).
 *
 * Behavioral coverage of the count/cap logic in `enforceEntityLimit` (the unit
 * that owns the rule: combined vendors+ai_systems count vs the per-org cap),
 * plus source-asserts pinning the handler wiring, the migration shape, the
 * Stripe-webhook transition guard, and the admin-set cap path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// pg is mocked for the behavioral section; the helper issues a single query.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockQuery }
}));

import { enforceEntityLimit } from "../lib/entityLimit.js";

const ORG = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// 1. Behavioral — combined count vs cap.
// ---------------------------------------------------------------------------
describe("enforceEntityLimit — combined count vs cap", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("at limit (count == cap) → exceeded (drives the 409)", async () => {
    // 30 vendors + 20 ai_systems = 50, cap 50.
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "50", cap: 50 }] });
    const r = await enforceEntityLimit(ORG);
    expect(r).toEqual({ exceeded: true, used: 50, cap: 50 });
  });

  it("under limit → not exceeded (create proceeds → 201)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "49", cap: 50 }] });
    const r = await enforceEntityLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 49, cap: 50 });
  });

  it("SUMs BOTH tables against ONE cap (not per-table)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "50", cap: 50 }] });
    await enforceEntityLimit(ORG);
    const sql = String(mockQuery.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/COUNT\(\*\)\s+FROM vendors\s+WHERE organization_id = o\.id/);
    expect(sql).toMatch(/COUNT\(\*\)\s+FROM ai_systems\s+WHERE organization_id = o\.id/);
    expect(sql).toMatch(/\+/); // the two counts are summed
    expect(sql).toMatch(/o\.max_monitored_entities/);
    // org id is the only bind parameter
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([ORG]);
  });

  it("does NOT filter vendors by status (a monitored entity is any row)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "0", cap: 50 }] });
    await enforceEntityLimit(ORG);
    const sql = String(mockQuery.mock.calls[0]?.[0] ?? "");
    expect(sql).not.toMatch(/status\s*=\s*'active'/);
    expect(sql).not.toMatch(/status\s*=\s*'archived'/);
  });

  it("admin-raised cap → previously-blocked count now allowed (→ 201)", async () => {
    // Same 50 entities, but the operator raised the cap to 100 (Platform Scale).
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "50", cap: 100 }] });
    const r = await enforceEntityLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 50, cap: 100 });
  });

  it("missing org row → defaults to cap 50, used 0, not exceeded", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await enforceEntityLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 0, cap: 50 });
  });

  it("null cap (legacy row before backfill) → defaults to 50", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ used: "10", cap: null }] });
    const r = await enforceEntityLimit(ORG);
    expect(r).toEqual({ exceeded: false, used: 10, cap: 50 });
  });
});

// ---------------------------------------------------------------------------
// 2. Wiring — both create handlers enforce the cap before INSERT, 409 shape.
// ---------------------------------------------------------------------------
const VENDORS_SRC = readFileSync(resolve(__dirname, "../routes/vendors.ts"), "utf8");
const AISYS_SRC = readFileSync(resolve(__dirname, "../routes/aiSystems.ts"), "utf8");

describe("entity-limit wiring — POST handlers", () => {
  for (const [name, src] of [["vendors.ts", VENDORS_SRC], ["aiSystems.ts", AISYS_SRC]] as const) {
    it(`${name} imports and calls enforceEntityLimit`, () => {
      expect(src).toMatch(/import \{ enforceEntityLimit \} from "\.\.\/lib\/entityLimit\.js"/);
      expect(src).toMatch(/enforceEntityLimit\(organizationId\)/);
    });

    it(`${name} returns 409 entity_limit_reached when exceeded`, () => {
      expect(src).toMatch(/limit\.exceeded/);
      expect(src).toMatch(/status\(409\)[\s\S]{0,120}entity_limit_reached/);
    });

    it(`${name} checks the cap AFTER validation and BEFORE the INSERT`, () => {
      const validateIdx = src.search(/validate(Vendor|AiSystem)Create/);
      const enforceIdx = src.indexOf("enforceEntityLimit(organizationId)");
      const insertIdx = src.search(/INSERT INTO (vendors|ai_systems)/);
      expect(validateIdx).toBeGreaterThan(-1);
      expect(enforceIdx).toBeGreaterThan(validateIdx);
      expect(insertIdx).toBeGreaterThan(enforceIdx);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Migration shape.
// ---------------------------------------------------------------------------
const MIGRATION_SRC = readFileSync(
  resolve(__dirname, "../../../db/migrations/20260623_org_max_monitored_entities.sql"),
  "utf8"
);

describe("max_monitored_entities migration", () => {
  it("adds the column to organizations, NOT NULL DEFAULT 50, idempotent", () => {
    expect(MIGRATION_SRC).toMatch(/ALTER TABLE organizations/);
    expect(MIGRATION_SRC).toMatch(
      /ADD COLUMN IF NOT EXISTS max_monitored_entities INTEGER NOT NULL DEFAULT 50/
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Stripe-webhook transition guard — cap resets only on a level change.
// ---------------------------------------------------------------------------
const WEBHOOK_SRC = readFileSync(resolve(__dirname, "../webhooks/stripeWebhook.ts"), "utf8");

describe("stripeWebhook — cap reset only on entitlement-level transition", () => {
  it("resets max_monitored_entities to 50 only when the prior level differs", () => {
    expect(WEBHOOK_SRC).toMatch(
      /max_monitored_entities\s*=\s*CASE[\s\S]{0,160}entitlement_level IS DISTINCT FROM \$1 THEN 50[\s\S]{0,80}ELSE max_monitored_entities/
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Admin-set cap (Platform Scale operator path).
// ---------------------------------------------------------------------------
const ADMIN_SRC = readFileSync(resolve(__dirname, "../routes/adminOrganizations.ts"), "utf8");

describe("adminOrganizations — operator can set max_monitored_entities", () => {
  it("parses and validates max_monitored_entities as a non-negative integer", () => {
    expect(ADMIN_SRC).toMatch(/req\.body\?\.max_monitored_entities/);
    expect(ADMIN_SRC).toMatch(/invalid_max_monitored_entities/);
    expect(ADMIN_SRC).toMatch(/Number\.isInteger/);
  });

  it("writes max_monitored_entities via COALESCE in the UPDATE and RETURNs it", () => {
    expect(ADMIN_SRC).toMatch(/max_monitored_entities\s*=\s*COALESCE\(\$8, max_monitored_entities\)/);
    expect(ADMIN_SRC).toMatch(/RETURNING[\s\S]{0,160}max_monitored_entities/);
  });
});
