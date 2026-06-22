import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateSignalMatchSuggestionAccept,
  validateSignalMatchSuggestionDismiss,
  isUuid,
  isTargetType,
  TARGET_TYPES
} from "../lib/signalMatchSuggestionValidation.js";

// Mocks for the behavioral test section at the bottom of this file.
// vitest hoists vi.mock to the top of the module, so the mock-fn refs must
// be declared via vi.hoisted to be initialized before the factory runs.
// Pure-validator and structural tests above this point do not import the
// route runtime and are unaffected.
//
// Two mocks: pg.connect (for the accept-handler transaction) and pg.query
// (for the dismiss + list handlers, which run single statements outside a
// transaction).
const { mockClientQuery, mockClientRelease } = vi.hoisted(() => ({
  mockClientQuery: vi.fn(),
  mockClientRelease: vi.fn()
}));
vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease
    })
  }
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn()
}));

const VALID_SUGGESTION_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_SIGNAL_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_TARGET_UUID = "22222222-2222-4222-8222-222222222222";
const VALID_ORG_UUID = "33333333-3333-4333-8333-333333333333";
const VALID_LINK_UUID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";

// ====================================================================
// validateSignalMatchSuggestionAccept — body shape
// ====================================================================

describe("validateSignalMatchSuggestionAccept — body shape", () => {
  it("accepts undefined body and returns null note", () => {
    const r = validateSignalMatchSuggestionAccept(undefined);
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts null body and returns null note", () => {
    const r = validateSignalMatchSuggestionAccept(null);
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts empty object body and returns null note", () => {
    const r = validateSignalMatchSuggestionAccept({});
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("rejects string body", () => {
    const r = validateSignalMatchSuggestionAccept("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_must_be_object");
  });

  it("rejects array body", () => {
    const r = validateSignalMatchSuggestionAccept([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_must_be_object");
  });
});

// ====================================================================
// validateSignalMatchSuggestionAccept — note
// ====================================================================

describe("validateSignalMatchSuggestionAccept — note", () => {
  it("trims a short note", () => {
    const r = validateSignalMatchSuggestionAccept({ note: "   matched on cve  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBe("matched on cve");
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateSignalMatchSuggestionAccept({ note: "   " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts explicit null", () => {
    const r = validateSignalMatchSuggestionAccept({ note: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("rejects non-string note", () => {
    const r = validateSignalMatchSuggestionAccept({ note: 42 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note longer than 500 chars", () => {
    const r = validateSignalMatchSuggestionAccept({ note: "a".repeat(501) });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note of exactly 500 chars", () => {
    const r = validateSignalMatchSuggestionAccept({ note: "a".repeat(500) });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note?.length).toBe(500);
  });

  it("never echoes any organization_id from body", () => {
    const r = validateSignalMatchSuggestionAccept({
      note: "x",
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(Object.keys(r.input).sort()).toEqual(["note"]);
  });
});

// ====================================================================
// validateSignalMatchSuggestionDismiss
// ====================================================================

describe("validateSignalMatchSuggestionDismiss", () => {
  it("accepts undefined body", () => {
    const r = validateSignalMatchSuggestionDismiss(undefined);
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.dismissal_reason).toBeNull();
  });

  it("accepts and trims a reason", () => {
    const r = validateSignalMatchSuggestionDismiss({
      dismissal_reason: "  not relevant to this org  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.dismissal_reason).toBe("not relevant to this org");
  });

  it("rejects non-string reason", () => {
    const r = validateSignalMatchSuggestionDismiss({ dismissal_reason: 9 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dismissal_reason_must_be_string");
  });

  it("rejects reason longer than 500 chars", () => {
    const r = validateSignalMatchSuggestionDismiss({
      dismissal_reason: "x".repeat(501)
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dismissal_reason_too_long");
  });

  it("rejects array body", () => {
    const r = validateSignalMatchSuggestionDismiss([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_must_be_object");
  });

  it("never echoes any organization_id from body", () => {
    const r = validateSignalMatchSuggestionDismiss({
      dismissal_reason: "x",
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(Object.keys(r.input).sort()).toEqual(["dismissal_reason"]);
  });
});

// ====================================================================
// isUuid + isTargetType + TARGET_TYPES
// ====================================================================

describe("isUuid", () => {
  it("accepts a v4-shaped UUID", () => {
    expect(isUuid(VALID_SUGGESTION_UUID)).toBe(true);
  });
  it("rejects empty", () => {
    expect(isUuid("")).toBe(false);
  });
  it("rejects malformed", () => {
    expect(isUuid("11111111-1111-4111-8111-1111")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isUuid(42)).toBe(false);
  });
});

describe("isTargetType", () => {
  for (const t of TARGET_TYPES) {
    it(`accepts ${t}`, () => {
      expect(isTargetType(t)).toBe(true);
    });
  }
  it("rejects unknown target_type", () => {
    expect(isTargetType("risk")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isTargetType("")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isTargetType(null)).toBe(false);
  });
});

describe("TARGET_TYPES enum", () => {
  it("contains exactly the four canonical link target types", () => {
    expect([...TARGET_TYPES].sort()).toEqual(
      ["ai_system", "control", "obligation", "vendor"].sort()
    );
  });
});

// ====================================================================
// Structural source guard for the route file.
// Mirrors the prior link-route slices; behavioral tests below cover the
// state-transition edge cases that cannot be verified structurally.
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/signalMatchSuggestions.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("signalMatchSuggestions route — tenant isolation invariants", () => {
  it("imports requireApiKey middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireApiKey/);
  });

  it("imports attachOrganizationContext middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*attachOrganizationContext/);
  });

  it("imports requireEntitlement middleware and gates on premium", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireEntitlement/);
    expect(ROUTE_SOURCE).toMatch(/requireEntitlement\(["']premium["']\)/);
  });

  it("references organization_id in SQL", () => {
    expect(ROUTE_SOURCE).toMatch(/organization_id/);
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });

  it("sources organizationId from req.organizationContext", () => {
    expect(ROUTE_SOURCE).toMatch(/organizationContext/);
  });

  it("returns 403 organization_context_missing when org context is absent", () => {
    expect(ROUTE_SOURCE).toMatch(/organization_context_missing/);
  });

  it("audit-logs via writeAuditEvent for accept and dismiss", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/signal_match_suggestion\.accepted/);
    expect(ROUTE_SOURCE).toMatch(/signal_match_suggestion\.dismissed/);
  });

  it("declares the three required endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/signal-match-suggestions["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.post\(\s*["']\/signal-match-suggestions\/:id\/accept["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.post\(\s*["']\/signal-match-suggestions\/:id\/dismiss["']/
    );
  });

  it("returns 404 (not 403) on cross-org access — no enumeration", () => {
    expect(ROUTE_SOURCE).toMatch(/signal_match_suggestion_not_found/);
    expect(ROUTE_SOURCE).toMatch(/target_not_found/);
    expect(ROUTE_SOURCE).toMatch(/cyber_signal_not_found/);
  });

  it("wraps the accept handler in a transaction (BEGIN / COMMIT / ROLLBACK)", () => {
    expect(ROUTE_SOURCE).toMatch(/await client\.query\(["']BEGIN["']\)/);
    expect(ROUTE_SOURCE).toMatch(/await client\.query\(["']COMMIT["']\)/);
    expect(ROUTE_SOURCE).toMatch(/await client\.query\(["']ROLLBACK["']\)/);
  });

  it("uses SELECT FOR UPDATE on the suggestion row inside the accept tx", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM signal_match_suggestions[\s\S]*WHERE id = \$1 AND organization_id = \$2[\s\S]*FOR UPDATE/
    );
  });

  it("link-table INSERT uses ON CONFLICT inference against the partial unique index (hardened template)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ON CONFLICT \(organization_id, signal_id, \$\{dispatch\.targetCol\}\)[\s\S]*WHERE deleted_at IS NULL[\s\S]*DO NOTHING/
    );
  });

  it("link-table INSERT sets created_by_user_id from req.userId", () => {
    expect(ROUTE_SOURCE).toMatch(
      /INSERT INTO \$\{dispatch\.linkTable\}[\s\S]*created_by_user_id[\s\S]*req\.userId/
    );
  });

  it("releases the pg client in finally", () => {
    expect(ROUTE_SOURCE).toMatch(/finally[\s\S]*client\.release\(\)/);
  });

  it("dismiss handler scopes UPDATE to organization_id and pending state", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE signal_match_suggestions[\s\S]*SET dismissed_at = NOW\(\)[\s\S]*WHERE id = \$3[\s\S]*AND organization_id = \$4[\s\S]*AND accepted_at IS NULL[\s\S]*AND dismissed_at IS NULL/
    );
  });

  it("documents the global-signal asymmetry citing the standard", () => {
    expect(ROUTE_SOURCE).toMatch(
      /global[\s\S]*organization_id IS NULL|TENANT_ISOLATION_STANDARD\.md §1/
    );
  });

  it("returns 409 on already-accepted and already-dismissed", () => {
    expect(ROUTE_SOURCE).toMatch(/signal_match_suggestion_already_accepted/);
    expect(ROUTE_SOURCE).toMatch(/signal_match_suggestion_already_dismissed/);
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260505_signal_match_suggestions.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("signal_match_suggestions migration", () => {
  it("creates the signal_match_suggestions table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS signal_match_suggestions/
    );
  });

  it("organization_id is NOT NULL and references organizations(id)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /organization_id\s+UUID\s+NOT NULL\s+REFERENCES organizations\(id\)/
    );
  });

  it("signal_id references cyber_signals(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /signal_id\s+UUID\s+NOT NULL\s+REFERENCES cyber_signals\(id\) ON DELETE CASCADE/
    );
  });

  it("target_id has NO foreign key (polymorphic by query)", () => {
    expect(MIGRATION_SOURCE).not.toMatch(
      /target_id\s+UUID\s+NOT NULL\s+REFERENCES/
    );
  });

  it("target_type CHECK enumerates exactly the four canonical types", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CHECK \(target_type IN \('vendor', 'ai_system', 'control', 'obligation'\)\)/
    );
  });

  it("declares the three-state CHECK constraint (pending / accepted / dismissed)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CONSTRAINT signal_match_suggestions_state_chk[\s\S]*accepted_at IS NULL[\s\S]*dismissed_at IS NULL[\s\S]*accepted_link_id IS NULL[\s\S]*OR[\s\S]*accepted_at IS NOT NULL[\s\S]*accepted_link_id IS NOT NULL[\s\S]*OR[\s\S]*dismissed_at IS NOT NULL/
    );
  });

  it("creates the partial unique index keyed on (org, signal, target_type, target_id) WHERE pending", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_match_suggestions_unique_pending[\s\S]*\(organization_id, signal_id, target_type, target_id\)[\s\S]*WHERE accepted_at IS NULL AND dismissed_at IS NULL/
    );
  });

  it("creates the accepted_link_id reverse-lookup index keyed on (accepted_link_id, target_type)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_accepted_link[\s\S]*\(accepted_link_id, target_type\)/
    );
  });

  it("does not alter cyber_signals or any signal_*_links table", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE cyber_signals/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE signal_vendor_links/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE signal_ai_system_links/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE signal_control_links/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE signal_obligation_links/);
  });
});

// ====================================================================
// Behavioral tests — accept + dismiss + list edge cases
//
// Mocks: pg.query (for list/dismiss), pg.connect → client (for accept tx),
// writeAuditEvent. Handlers are imported by name from the route file.
// ====================================================================

import { pg } from "../infra/postgres.js";
import {
  acceptSignalMatchSuggestion,
  dismissSignalMatchSuggestion,
  listSignalMatchSuggestions,
  recomputeSignalMatchSuggestionScore,
  getSignalMatchSuggestionCounts
} from "../routes/signalMatchSuggestions.js";
import { DEFAULT_WEIGHTS } from "../lib/riskScoring.js";

const mockPgQuery = pg.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function pendingSuggestionRow(targetType = "vendor") {
  return {
    id: VALID_SUGGESTION_UUID,
    organization_id: VALID_ORG_UUID,
    signal_id: VALID_SIGNAL_UUID,
    target_type: targetType,
    target_id: VALID_TARGET_UUID,
    match_reason: "vendor_name_ilike",
    // 75 = High severity (0.75) × high vendor criticality (0.75) × 1.0 × 100,
    // a plausible computeRiskScore output rather than an arbitrary fixture.
    match_score: 75,
    created_at: "2026-05-05T00:00:00.000Z",
    accepted_at: null,
    accepted_by_user_id: null,
    accepted_link_id: null,
    dismissed_at: null,
    dismissed_by_user_id: null,
    dismissal_reason: null
  };
}

function acceptedSuggestionRow(linkId = VALID_LINK_UUID) {
  return {
    ...pendingSuggestionRow(),
    accepted_at: "2026-05-05T01:00:00.000Z",
    accepted_by_user_id: OTHER_USER_UUID,
    accepted_link_id: linkId
  };
}

function dismissedSuggestionRow() {
  return {
    ...pendingSuggestionRow(),
    dismissed_at: "2026-05-05T01:00:00.000Z",
    dismissed_by_user_id: OTHER_USER_UUID,
    dismissal_reason: "not relevant"
  };
}

function newLinkRow() {
  return {
    id: VALID_LINK_UUID,
    organization_id: VALID_ORG_UUID,
    signal_id: VALID_SIGNAL_UUID,
    vendor_id: VALID_TARGET_UUID,
    note: null,
    created_by_user_id: null,
    created_at: "2026-05-05T01:00:00.000Z",
    deleted_at: null
  };
}

describe("signalMatchSuggestions — accept handler", () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockPgQuery.mockReset();
  });

  it("happy path: pending → accepted, creates link row, returns 200 with both", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                 // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow()] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })               // target preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })               // signal preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [newLinkRow()] })     // INSERT link
      .mockResolvedValueOnce({ rowCount: 1, rows: [acceptedSuggestionRow()] }) // UPDATE suggestion
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                // COMMIT

    const req = {
      body: { note: "confirmed match" },
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion: expect.objectContaining({ accepted_link_id: VALID_LINK_UUID }),
        link: expect.objectContaining({ id: VALID_LINK_UUID }),
        link_already_existed: false
      })
    );
    // 7 client.query calls: BEGIN, SELECT FOR UPDATE, target, signal, INSERT, UPDATE, COMMIT
    expect(mockClientQuery).toHaveBeenCalledTimes(7);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    // No COMMIT-then-ROLLBACK on the happy path
    expect(mockClientQuery.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(false);
  });

  it("link-already-exists path: pending → accepted, INSERT conflicts, SELECT existing link, returns 200 link_already_existed:true", async () => {
    const existingLink = { ...newLinkRow(), note: "manually created earlier" };
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                 // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow()] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })               // target preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })               // signal preflight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                 // INSERT link → CONFLICT
      .mockResolvedValueOnce({ rowCount: 1, rows: [existingLink] })     // SELECT existing live link
      .mockResolvedValueOnce({ rowCount: 1, rows: [acceptedSuggestionRow()] }) // UPDATE suggestion
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                // COMMIT

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion: expect.objectContaining({ accepted_link_id: VALID_LINK_UUID }),
        link: existingLink,
        link_already_existed: true
      })
    );
    // 8 client.query calls (one extra SELECT for the existing link)
    expect(mockClientQuery).toHaveBeenCalledTimes(8);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("already-accepted: returns 409 and rolls back without writing", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [acceptedSuggestionRow()] }) // SELECT FOR UPDATE returns terminal row
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                 // ROLLBACK

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_accepted" })
    );
    // BEGIN, SELECT FOR UPDATE, ROLLBACK only — no link insert, no UPDATE
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    expect(mockClientQuery.mock.calls[2][0]).toBe("ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("already-dismissed: returns 409 and rolls back without writing", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                   // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [dismissedSuggestionRow()] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                  // ROLLBACK

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_dismissed" })
    );
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    expect(mockClientQuery.mock.calls[2][0]).toBe("ROLLBACK");
  });

  it("cross-tenant suggestion id: returns 404 (not 403) — no enumeration", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // SELECT FOR UPDATE → 0 rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // ROLLBACK

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_not_found" })
    );
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
  });

  it("target row missing in this org: returns 404 target_not_found and rolls back", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow()] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                  // target preflight → 0 rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                 // ROLLBACK

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "target_not_found" })
    );
    // BEGIN, SELECT FOR UPDATE, target preflight, ROLLBACK
    expect(mockClientQuery).toHaveBeenCalledTimes(4);
    expect(mockClientQuery.mock.calls[3][0]).toBe("ROLLBACK");
  });

  it("signal not visible to this org and not global: returns 404 cyber_signal_not_found", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow()] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })                // target preflight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                  // signal preflight → 0 rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                 // ROLLBACK

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "cyber_signal_not_found" })
    );
    expect(mockClientQuery).toHaveBeenCalledTimes(5);
    expect(mockClientQuery.mock.calls[4][0]).toBe("ROLLBACK");
  });

  it("non-uuid suggestion id: returns 400 without opening a tx", async () => {
    const req = {
      body: {},
      params: { id: "not-a-uuid" },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "suggestion_id_must_be_uuid" })
    );
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockClientRelease).not.toHaveBeenCalled();
  });

  it("link INSERT failure mid-tx: returns 500, ROLLBACK issued, no UPDATE, suggestion stays pending", async () => {
    // Simulates e.g. a transient pg error or a constraint violation after
    // preflights pass. The handler MUST roll back and report 500; the
    // suggestion row MUST NOT transition out of pending state.
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                   // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow()] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })                 // target preflight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })                 // signal preflight
      .mockRejectedValueOnce(new Error("simulated link INSERT failure"))  // INSERT throws
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                  // ROLLBACK in catch

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_accept_failed" })
    );
    // Tx tape: BEGIN, SELECT FOR UPDATE, target, signal, INSERT (threw), ROLLBACK
    expect(mockClientQuery).toHaveBeenCalledTimes(6);
    // ROLLBACK must be the final statement issued.
    expect(mockClientQuery.mock.calls[5][0]).toBe("ROLLBACK");
    // No suggestion UPDATE was issued — suggestion stays pending.
    const updateCalled = mockClientQuery.mock.calls.some(
      (c) => typeof c[0] === "string" && /UPDATE signal_match_suggestions/.test(c[0])
    );
    expect(updateCalled).toBe(false);
    // No COMMIT was issued.
    expect(mockClientQuery.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
    // Client must be released even on failure.
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("validator error short-circuits before opening a tx", async () => {
    const req = {
      body: { note: 42 },
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof acceptSignalMatchSuggestion>[0];
    const res = makeRes();

    await acceptSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof acceptSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "note_must_be_string" })
    );
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

describe("signalMatchSuggestions — dismiss handler", () => {
  beforeEach(() => {
    mockPgQuery.mockReset();
    mockClientQuery.mockReset();
  });

  it("happy path: pending → dismissed, returns 200 with updated suggestion", async () => {
    mockPgQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [dismissedSuggestionRow()]
    });

    const req = {
      body: { dismissal_reason: "not relevant" },
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof dismissSignalMatchSuggestion>[0];
    const res = makeRes();

    await dismissSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof dismissSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion: expect.objectContaining({ dismissed_at: expect.any(String) })
      })
    );
    expect(mockPgQuery).toHaveBeenCalledTimes(1);
  });

  it("already-accepted: UPDATE returns 0, discriminator finds accepted_at → 409 already_accepted", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // UPDATE returns 0
      .mockResolvedValueOnce({                            // discriminator SELECT
        rowCount: 1,
        rows: [{ accepted_at: "2026-05-05T01:00:00.000Z", dismissed_at: null }]
      });

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof dismissSignalMatchSuggestion>[0];
    const res = makeRes();

    await dismissSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof dismissSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_accepted" })
    );
    expect(mockPgQuery).toHaveBeenCalledTimes(2);
  });

  it("already-dismissed: UPDATE returns 0, discriminator finds dismissed_at → 409 already_dismissed", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ accepted_at: null, dismissed_at: "2026-05-05T01:00:00.000Z" }]
      });

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof dismissSignalMatchSuggestion>[0];
    const res = makeRes();

    await dismissSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof dismissSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_dismissed" })
    );
    expect(mockPgQuery).toHaveBeenCalledTimes(2);
  });

  it("cross-tenant or non-existent: UPDATE returns 0, discriminator finds nothing → 404", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = {
      body: {},
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof dismissSignalMatchSuggestion>[0];
    const res = makeRes();

    await dismissSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof dismissSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_not_found" })
    );
  });

  it("non-uuid id: 400 without hitting pg", async () => {
    const req = {
      body: {},
      params: { id: "nope" },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof dismissSignalMatchSuggestion>[0];
    const res = makeRes();

    await dismissSignalMatchSuggestion(
      req,
      res as unknown as Parameters<typeof dismissSignalMatchSuggestion>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "suggestion_id_must_be_uuid" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });
});

describe("signalMatchSuggestions — list handler", () => {
  beforeEach(() => {
    mockPgQuery.mockReset();
  });

  it("default status=pending, returns 200 with rows", async () => {
    mockPgQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [pendingSuggestionRow()]
    });

    const req = {
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        status: "pending",
        organizationId: VALID_ORG_UUID,
        suggestions: expect.any(Array)
      })
    );
    expect(mockPgQuery).toHaveBeenCalledTimes(1);
    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/accepted_at IS NULL AND dismissed_at IS NULL/);
  });

  it("status=accepted filters via accepted_at IS NOT NULL", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: { status: "accepted" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/accepted_at IS NOT NULL/);
  });

  it("invalid status returns 400 without hitting pg", async () => {
    const req = {
      query: { status: "weird" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_status" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("invalid target_type returns 400", async () => {
    const req = {
      query: { target_type: "risk" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_target_type" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("fractional limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "10.5" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("non-numeric limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "abc" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("missing org context returns 403 organization_context_missing", async () => {
    const req = {
      query: {}
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "organization_context_missing" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  // ====================================================================
  // ?sort and ?offset extensions — Package 4 backend additions
  // ====================================================================

  it("default sort emits ORDER BY created_at DESC, id DESC (preserves prior caller behavior)", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY s\.created_at DESC, s\.id DESC/);
    expect(sql).not.toMatch(/match_score DESC/);
  });

  it("?sort=created-desc emits the same ORDER BY as the default", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: { sort: "created-desc" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY s\.created_at DESC, s\.id DESC/);
  });

  it("?sort=score-desc emits ORDER BY match_score DESC NULLS LAST with stable tie-break on created_at, id", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: { sort: "score-desc" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY s\.match_score DESC NULLS LAST, s\.created_at DESC, s\.id DESC/);
  });

  it("?sort=score-desc echoes back in the response body", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: { sort: "score-desc" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "score-desc" })
    );
  });

  it("invalid ?sort returns 400 invalid_sort without hitting pg", async () => {
    const req = {
      query: { sort: "alphabetical" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_sort" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("?offset is passed as the final positional parameter alongside LIMIT", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: { offset: "50" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    const params = mockPgQuery.mock.calls[0][1] as unknown[];
    expect(sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    // params: [orgId, limit, offset]
    expect(params[params.length - 1]).toBe(50);
  });

  it("?offset=0 (default) sends 0, not undefined", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const params = mockPgQuery.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(0);
  });

  it("negative ?offset is clamped to 0 (treated as 'from start', not 400)", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: { offset: "-5" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const params = mockPgQuery.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toBe(0);
  });

  it("fractional ?offset returns 400 invalid_offset without hitting pg", async () => {
    const req = {
      query: { offset: "10.5" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_offset" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("non-numeric ?offset returns 400 invalid_offset", async () => {
    const req = {
      query: { offset: "abc" },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_offset" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // target_name enrichment — the API resolves target_id to the entity's
  // human-readable name via four LEFT JOINs (vendors, ai_systems,
  // controls, obligations) with a COALESCE alias. The frontend renders
  // target_name when present and falls back to target_id UUID otherwise.
  //
  // These tests assert two things:
  //   1. The SQL contains the JOIN block and the COALESCE alias — so a
  //      future refactor that drops them would fail loudly here.
  //   2. The resolved target_name surfaces in the response when pg
  //      returns one, and is null for an orphan row (target_id pointing
  //      at a deleted vendor).
  // ------------------------------------------------------------------

  it("list SQL JOINs the four target tables and aliases COALESCE as target_name", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = {
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/LEFT JOIN vendors\s+v\s+ON s\.target_type = 'vendor'/);
    expect(sql).toMatch(/LEFT JOIN ai_systems\s+ai\s+ON s\.target_type = 'ai_system'/);
    expect(sql).toMatch(/LEFT JOIN controls\s+c\s+ON s\.target_type = 'control'/);
    expect(sql).toMatch(/LEFT JOIN obligations\s+o\s+ON s\.target_type = 'obligation'/);
    expect(sql).toMatch(/COALESCE\(v\.name, ai\.name, c\.name, o\.title\) AS target_name/);
  });

  it("returns target_name in the suggestion row when the JOIN resolves a vendor name", async () => {
    const enrichedRow = { ...pendingSuggestionRow("vendor"), target_name: "Apache" };
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [enrichedRow] });

    const req = {
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0] as { suggestions: Array<Record<string, unknown>> };
    expect(body.suggestions[0]?.target_name).toBe("Apache");
    expect(body.suggestions[0]?.target_id).toBe(VALID_TARGET_UUID);
  });

  it("returns target_name = null for an orphan row whose target_id has no matching entity", async () => {
    // All four LEFT JOINs return null when target_id points at a row that
    // was deleted (or never existed) — the COALESCE then resolves to null.
    // Frontend's `?? target_id` fallback at SuggestionList.tsx:363 handles
    // this gracefully; we just need the field to be null, not undefined.
    const orphanRow = { ...pendingSuggestionRow("vendor"), target_name: null };
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [orphanRow] });

    const req = {
      query: {},
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalMatchSuggestions>[0];
    const res = makeRes();

    await listSignalMatchSuggestions(
      req,
      res as unknown as Parameters<typeof listSignalMatchSuggestions>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0] as { suggestions: Array<Record<string, unknown>> };
    expect(body.suggestions[0]?.target_name).toBeNull();
  });
});

// ====================================================================
// getSignalMatchSuggestionCounts — pending breakdown + lifetime_total
// ====================================================================

describe("signalMatchSuggestions — counts handler", () => {
  beforeEach(() => {
    mockPgQuery.mockReset();
  });

  it("happy path: returns total, by_target_type breakdown, and lifetime_total", async () => {
    mockPgQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          total: "12",
          vendor: "5",
          ai_system: "3",
          control: "2",
          obligation: "2",
          lifetime_total: "47"
        }
      ]
    });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[0];
    const res = makeRes();

    await getSignalMatchSuggestionCounts(
      req,
      res as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      organizationId: VALID_ORG_UUID,
      total: 12,
      by_target_type: { vendor: 5, ai_system: 3, control: 2, obligation: 2 },
      lifetime_total: 47
    });
    // pg.query was called once — single round-trip aggregate.
    expect(mockPgQuery).toHaveBeenCalledTimes(1);
  });

  it("coerces bigint string counts to JS numbers", async () => {
    // pg returns COUNT(*) as a string; the handler must coerce.
    mockPgQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          total: "0",
          vendor: "0",
          ai_system: "0",
          control: "0",
          obligation: "0",
          lifetime_total: "0"
        }
      ]
    });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[0];
    const res = makeRes();

    await getSignalMatchSuggestionCounts(
      req,
      res as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[1]
    );

    const body = res.json.mock.calls[0][0] as Record<string, unknown>;
    expect(body.total).toBe(0);
    expect(body.lifetime_total).toBe(0);
    const breakdown = body.by_target_type as Record<string, unknown>;
    for (const v of Object.values(breakdown)) {
      expect(typeof v).toBe("number");
    }
  });

  it("filters all aggregates by organization_id", async () => {
    mockPgQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          total: "0",
          vendor: "0",
          ai_system: "0",
          control: "0",
          obligation: "0",
          lifetime_total: "0"
        }
      ]
    });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[0];
    const res = makeRes();

    await getSignalMatchSuggestionCounts(
      req,
      res as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    const params = mockPgQuery.mock.calls[0][1] as unknown[];
    expect(sql).toMatch(/WHERE organization_id = \$1/);
    expect(params).toEqual([VALID_ORG_UUID]);
  });

  it("pending breakdown excludes accepted and dismissed via FILTER predicates", async () => {
    mockPgQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          total: "0",
          vendor: "0",
          ai_system: "0",
          control: "0",
          obligation: "0",
          lifetime_total: "0"
        }
      ]
    });

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[0];
    const res = makeRes();

    await getSignalMatchSuggestionCounts(
      req,
      res as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[1]
    );

    const sql = mockPgQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/FILTER \(WHERE accepted_at IS NULL AND dismissed_at IS NULL\)/);
    // lifetime_total must be a plain COUNT(*) — no state predicate.
    expect(sql).toMatch(/COUNT\(\*\)\s+AS lifetime_total/);
  });

  it("missing org context returns 403 organization_context_missing without hitting pg", async () => {
    const req = {} as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[0];
    const res = makeRes();

    await getSignalMatchSuggestionCounts(
      req,
      res as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[1]
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "organization_context_missing" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("pg error returns 500 signal_match_suggestions_counts_failed", async () => {
    mockPgQuery.mockRejectedValueOnce(new Error("connection refused"));

    const req = {
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[0];
    const res = makeRes();

    await getSignalMatchSuggestionCounts(
      req,
      res as unknown as Parameters<typeof getSignalMatchSuggestionCounts>[1]
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestions_counts_failed" })
    );
  });
});

// ====================================================================
// recomputeSignalMatchSuggestionScore — score recompute handler
// Mirrors the dispatch + scoring pipeline. Each test sets up the full
// query tape (suggestion read, signal read, entity read, weights read,
// match_score UPDATE) so the handler walks the real path.
// ====================================================================

describe("signalMatchSuggestions — recompute-score handler", () => {
  beforeEach(() => {
    mockPgQuery.mockReset();
  });

  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      params: { id: VALID_SUGGESTION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1",
      ...overrides
    } as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[0];
  }

  it("happy path (vendor target, weights row exists): returns 200 with score+breakdown+explanation, weights_source='configured'", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })             // suggestion read
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "High", source: "nvd" }] })        // signal read
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "high" }] })                    // vendor read
      .mockResolvedValueOnce({                                                                     // weights read
        rowCount: 1,
        rows: [{
          entity_criticality_weights: DEFAULT_WEIGHTS.entity_criticality_weights,
          obligation_priority_weights: DEFAULT_WEIGHTS.obligation_priority_weights,
          severity_weights: DEFAULT_WEIGHTS.severity_weights
        }]
      })
      .mockResolvedValueOnce({                                                                     // match_score UPDATE
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("vendor"), match_score: 56 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    // High severity (0.75) * high vendor criticality (0.75) * 1.0 (vendor) * 100 = 56.25 → rounded to 56.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 56,
        breakdown: expect.objectContaining({
          severity: 0.75,
          entity: 0.75,
          obligation: 1.0
        }),
        explanation: expect.any(String),
        weights_source: "configured"
      })
    );
  });

  it("falls back to DEFAULT_WEIGHTS when no weights row exists for org (weights_source='default')", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })       // suggestion
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "Critical", source: "nvd" }] }) // signal
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "critical" }] })          // vendor
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                     // weights: NONE
      .mockResolvedValueOnce({                                                                // UPDATE
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("vendor"), match_score: 100 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 100,
        weights_source: "default"
      })
    );
  });

  it("KEV-source signal with stored severity='Low' produces score reflecting KEV override (severity_w=1.0)", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })     // suggestion
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "Low", source: "cisa-kev" }] }) // signal: Low + KEV
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "critical" }] })        // vendor: critical
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                   // weights: defaults
      .mockResolvedValueOnce({                                                              // UPDATE
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("vendor"), match_score: 100 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    // KEV override → severity_w = 1.0 even though stored severity is 'Low'
    // critical vendor → entity_w = 1.0
    // vendor → obligation_w = 1.0
    // 1.0 * 1.0 * 1.0 * 100 = 100
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 100,
        breakdown: expect.objectContaining({ severity: 1.0 }),
        explanation: expect.stringMatching(/KEV override applied/i)
      })
    );
  });

  it("control-typed suggestion always defaults entity dimension and flags it in explanation", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("control")] })   // suggestion
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "Critical", source: "nvd" }] }) // signal: Critical
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })                                // control existence check
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                  // weights: defaults
      .mockResolvedValueOnce({                                                            // UPDATE
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("control"), match_score: 50 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    // Critical (1.0) * default 0.5 (control) * 1.0 (control entity) * 100 = 50
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 50,
        breakdown: expect.objectContaining({ entity: 0.5 }),
        explanation: expect.stringMatching(/controls have no criticality column/i)
      })
    );
  });

  it("missing severity defaults severity weight and flags 'defaulted' in explanation", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })     // suggestion
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: null, source: "nvd" }] })  // signal: null severity
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "high" }] })            // vendor
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                   // weights: defaults
      .mockResolvedValueOnce({                                                              // UPDATE
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("vendor"), match_score: 38 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    // 0.5 default * 0.75 high vendor * 1.0 * 100 = 37.5 → rounds to 38
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 38,
        breakdown: expect.objectContaining({ severity: 0.5 }),
        explanation: expect.stringMatching(/severity:\s*defaulted/i)
      })
    );
  });

  it("obligation-typed suggestion with priority='immediate' scores at full range (entity dim is type-by-design neutral)", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("obligation")] }) // suggestion
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "High", source: "nvd" }] }) // signal
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ priority: "immediate" }] })          // obligation: immediate
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                   // weights: defaults
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("obligation"), match_score: 75 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    // High (0.75) * 1.0 entity (obligation type-by-design neutral) * immediate (1.0) * 100 = 75
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 75,
        breakdown: expect.objectContaining({ entity: 1.0, obligation: 1.0 })
      })
    );
    // Obligation entity dimension must NOT produce a 'defaulted' flag.
    const responseArg = res.json.mock.calls[0][0] as { explanation: string };
    expect(responseArg.explanation).not.toMatch(/entity:\s*defaulted/i);
  });

  it("Critical + obligation priority=immediate ⇒ 100 (full range reachable for obligations)", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("obligation")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "Critical", source: "nvd" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ priority: "immediate" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("obligation"), match_score: 100 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ score: 100 })
    );
  });

  it("obligation with null priority: obligation dim defaults (flag), entity dim stays neutral (no flag)", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("obligation")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "High", source: "nvd" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ priority: null }] })  // obligation: null priority
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...pendingSuggestionRow("obligation"), match_score: 38 }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    // High (0.75) * 1.0 entity (neutral) * 0.5 obligation (defaulted) * 100 = 37.5 → 38
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 38,
        breakdown: expect.objectContaining({ entity: 1.0, obligation: 0.5 }),
        explanation: expect.stringMatching(/obligation:\s*defaulted/i)
      })
    );
    const responseArg = res.json.mock.calls[0][0] as { explanation: string };
    expect(responseArg.explanation).not.toMatch(/entity:\s*defaulted/i);
  });

  it("cross-tenant suggestion id: returns 404 (not 403) — no enumeration", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_not_found" })
    );
    expect(mockPgQuery).toHaveBeenCalledTimes(1);
  });

  it("already-accepted suggestion: returns 409, no further DB access", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [acceptedSuggestionRow()] });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_accepted" })
    );
    expect(mockPgQuery).toHaveBeenCalledTimes(1);
  });

  it("already-dismissed suggestion: returns 409", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [dismissedSuggestionRow()] });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_dismissed" })
    );
  });

  it("non-uuid id: returns 400 without DB access", async () => {
    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq({ params: { id: "not-a-uuid" } }),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "suggestion_id_must_be_uuid" })
    );
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("signal not found / cross-org: returns 404 cyber_signal_not_found", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // signal preflight: 0 rows

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "cyber_signal_not_found" })
    );
  });

  it("target entity not found / cross-org: returns 404 target_not_found", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "High", source: "nvd" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // vendor: 0 rows

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "target_not_found" })
    );
  });

  it("race: suggestion accepted between read and update → 409 already_accepted", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [pendingSuggestionRow("vendor")] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ severity: "High", source: "nvd" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "high" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // weights: defaults
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // UPDATE: 0 rows (state changed)
      .mockResolvedValueOnce({                            // discriminator SELECT
        rowCount: 1,
        rows: [{ accepted_at: "2026-05-05T01:00:00.000Z", dismissed_at: null }]
      });

    const res = makeRes();
    await recomputeSignalMatchSuggestionScore(
      makeReq(),
      res as unknown as Parameters<typeof recomputeSignalMatchSuggestionScore>[1]
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "signal_match_suggestion_already_accepted" })
    );
  });
});
