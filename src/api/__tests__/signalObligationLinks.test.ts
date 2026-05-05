import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateSignalObligationLinkCreate,
  isUuid
} from "../lib/signalObligationLinkValidation.js";

// Mocks for the behavioral test section at the bottom of this file.
// vitest hoists vi.mock to the top of the module, so these take effect
// before the route file is imported below. Pure-validator and structural
// tests above this point do not import the route runtime and are unaffected.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() }
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn()
}));

const VALID_SIGNAL_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_OBLIGATION_UUID = "e5f6a7b8-c9d0-1234-efab-3456789012cd";
const VALID_ORG_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_LINK_UUID = "55555555-5555-4555-8555-555555555555";

// ====================================================================
// validateSignalObligationLinkCreate — body shape
// ====================================================================

describe("validateSignalObligationLinkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateSignalObligationLinkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateSignalObligationLinkCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateSignalObligationLinkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateSignalObligationLinkCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ====================================================================
// validateSignalObligationLinkCreate — signal_id
// ====================================================================

describe("validateSignalObligationLinkCreate — signal_id", () => {
  it("rejects missing signal_id", () => {
    const r = validateSignalObligationLinkCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects empty signal_id", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: "   ",
      obligation_id: VALID_OBLIGATION_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects numeric signal_id", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: 42,
      obligation_id: VALID_OBLIGATION_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects non-UUID signal_id", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: "not-a-uuid",
      obligation_id: VALID_OBLIGATION_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalObligationLinkCreate — obligation_id
// ====================================================================

describe("validateSignalObligationLinkCreate — obligation_id", () => {
  it("rejects missing obligation_id", () => {
    const r = validateSignalObligationLinkCreate({ signal_id: VALID_SIGNAL_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects empty obligation_id", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects non-UUID obligation_id", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalObligationLinkCreate — note
// ====================================================================

describe("validateSignalObligationLinkCreate — note", () => {
  it("defaults note to null when omitted", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts a short note and trims it", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: "   regulatory change directly affects this obligation  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(r.input.note).toBe("regulatory change directly affects this obligation");
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: "   "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts explicit null note", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("rejects non-string note", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note longer than 500 chars", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: "a".repeat(501)
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note of exactly 500 chars", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: "a".repeat(500)
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note?.length).toBe(500);
  });
});

// ====================================================================
// validateSignalObligationLinkCreate — happy path
// ====================================================================

describe("validateSignalObligationLinkCreate — happy path", () => {
  it("returns trimmed signal_id and obligation_id", () => {
    const r = validateSignalObligationLinkCreate({
      signal_id: `  ${VALID_SIGNAL_UUID}  `,
      obligation_id: `  ${VALID_OBLIGATION_UUID}  `,
      note: "context"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.signal_id).toBe(VALID_SIGNAL_UUID);
      expect(r.input.obligation_id).toBe(VALID_OBLIGATION_UUID);
      expect(r.input.note).toBe("context");
    }
  });

  it("ignores any organization_id value supplied in the body", () => {
    // The validator MUST NOT echo organization_id through. organization_id is
    // sourced exclusively from req.organizationContext at the route layer.
    const r = validateSignalObligationLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(
        ["note", "obligation_id", "signal_id"].sort()
      );
    }
  });
});

// ====================================================================
// isUuid
// ====================================================================

describe("isUuid", () => {
  it("accepts a v4-shaped UUID", () => {
    expect(isUuid(VALID_SIGNAL_UUID)).toBe(true);
  });

  it("accepts uppercase UUID", () => {
    expect(isUuid(VALID_SIGNAL_UUID.toUpperCase())).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects malformed UUID", () => {
    expect(isUuid("a1b2c3d4-e5f6-7890-abcd-ef")).toBe(false);
  });

  it("rejects null", () => {
    expect(isUuid(null)).toBe(false);
  });

  it("rejects number", () => {
    expect(isUuid(42)).toBe(false);
  });
});

// ====================================================================
// Structural source guard for the new route file.
//
// Mirrors tenantScopingGuard.test.ts and the prior link-slice tests:
// assert structural invariants on the route source. Behavioral tests
// at the bottom of this file cover two specific edge cases (parseLimit
// + ON CONFLICT). Full HTTP test harness for link routes is now
// pullable from BUILD_SEQUENCE.md backlog (prerequisite met as of this
// slice — all four link tables landed).
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/signalObligationLinks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("signalObligationLinks route — tenant isolation invariants", () => {
  it("imports requireApiKey middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireApiKey/);
    expect(ROUTE_SOURCE).toMatch(/requireApiKey/);
  });

  it("imports attachOrganizationContext middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*attachOrganizationContext/);
    expect(ROUTE_SOURCE).toMatch(/attachOrganizationContext/);
  });

  it("imports requireEntitlement middleware", () => {
    expect(ROUTE_SOURCE).toMatch(/from ["'][^"']*requireEntitlement/);
    expect(ROUTE_SOURCE).toMatch(/requireEntitlement\(["']standard["']\)/);
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

  it("audit-logs via writeAuditEvent for create and delete", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/signal_obligation_link\.created/);
    expect(ROUTE_SOURCE).toMatch(/signal_obligation_link\.deleted/);
  });

  it("uses soft delete (deleted_at IS NULL) for live-link queries", () => {
    expect(ROUTE_SOURCE).toMatch(/deleted_at IS NULL/);
    expect(ROUTE_SOURCE).toMatch(/SET deleted_at = NOW\(\)/);
  });

  it("performs cross-row same-org pre-flight on obligation", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM obligations WHERE id = \$1 AND organization_id = \$2/
    );
  });

  it("declares all four required endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.post\(\s*["']\/signal-obligation-links["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.delete\(\s*["']\/signal-obligation-links\/:id["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/obligations\/:id\/signals["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/cyber-signals\/:id\/obligations["']/
    );
  });

  it("scopes DELETE to organization_id (no IDOR)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE signal_obligation_links[\s\S]*WHERE id = \$1[\s\S]*AND organization_id = \$2/
    );
  });

  it("returns 404 (not 403) on cross-org access — no enumeration", () => {
    expect(ROUTE_SOURCE).toMatch(/obligation_not_found/);
    expect(ROUTE_SOURCE).toMatch(/cyber_signal_not_found/);
    expect(ROUTE_SOURCE).toMatch(/signal_obligation_link_not_found/);
  });

  it("uses ON CONFLICT inference against the partial unique index (hardened template)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ON CONFLICT \(organization_id, signal_id, obligation_id\)[\s\S]*WHERE deleted_at IS NULL[\s\S]*DO NOTHING/
    );
  });
});

// ====================================================================
// Global-signal asymmetry guard.
//
// Asserts org-scoped obligations can be linked to global cyber_signals
// (organization_id IS NULL). Public-source threat signals (CISA KEV,
// NVD, MITRE, regulatory feeds) are visible to every org and may be
// linked to any org's obligations. The route MUST handle this in
// (a) the cross-row signal pre-flight on POST, (b) the listing query
// on GET /api/obligations/:id/signals, and (c) the pre-flight on the
// reverse listing GET /api/cyber-signals/:id/obligations.
// ====================================================================

describe("signalObligationLinks route — global cyber_signals (organization_id IS NULL) path", () => {
  it("POST signal pre-flight permits global signals", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM cyber_signals[\s\S]*WHERE id = \$1[\s\S]*AND \(organization_id = \$2 OR organization_id IS NULL\)/
    );
  });

  it("GET /api/obligations/:id/signals returns same-org AND global signals via the JOIN filter", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM signal_obligation_links sol[\s\S]*JOIN cyber_signals cs[\s\S]*WHERE[\s\S]*\(cs\.organization_id = \$1 OR cs\.organization_id IS NULL\)/
    );
  });

  it("GET /api/cyber-signals/:id/obligations pre-flight permits global signals", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM cyber_signals[\s\S]*WHERE id = \$1[\s\S]*AND \(organization_id = \$2 OR organization_id IS NULL\)/
    );
  });

  it("documents the asymmetry with an inline comment naming the standard", () => {
    expect(ROUTE_SOURCE).toMatch(/global[\s\S]*organization_id IS NULL[\s\S]*§1|TENANT_ISOLATION_STANDARD\.md §1/);
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260505_signal_obligation_links.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("signal_obligation_links migration", () => {
  it("creates the signal_obligation_links table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS signal_obligation_links/
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

  it("obligation_id references obligations(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /obligation_id\s+UUID\s+NOT NULL\s+REFERENCES obligations\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("declares deleted_at for soft delete", () => {
    expect(MIGRATION_SOURCE).toMatch(/deleted_at\s+TIMESTAMPTZ\s+NULL/);
  });

  it("creates a partial unique index keyed on (org, signal, obligation) WHERE deleted_at IS NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_obligation_links_unique_active[\s\S]*\(organization_id, signal_id, obligation_id\)[\s\S]*WHERE deleted_at IS NULL/
    );
  });

  it("creates the per-obligation and per-signal hot-read indexes", () => {
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_obligation_links_org_obligation/);
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_obligation_links_org_signal/);
  });

  it("does not alter cyber_signals, obligations, findings, or risks", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE cyber_signals/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE obligations/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE findings/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE risks/);
  });
});

// ====================================================================
// Behavioral tests — IMPORTANT, READ THIS BEFORE EXTENDING
//
// These are the only behavioral tests in this repo. They cover two
// specific edge cases that cannot be verified structurally:
//
//   (1) parseLimit fractional/non-numeric input → 400 invalid_limit
//   (2) Idempotent insert under ON CONFLICT → 200 with existing row
//
// The full HTTP test harness for link routes is now pullable from
// BUILD_SEQUENCE.md backlog — all four link tables are landed as of
// this slice. DO NOT extend behavioral coverage piecemeal here —
// backfill via the harness package.
//
// Mocks: pg.query and writeAuditEvent. Handlers are imported by name
// from the route file (which exports them for direct invocation).
// ====================================================================

import { pg } from "../infra/postgres.js";
import {
  createSignalObligationLink,
  listSignalsForObligation
} from "../routes/signalObligationLinks.js";

const mockQuery = pg.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("signalObligationLinks — behavioral edge cases", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ---- parseLimit cases ----

  it("GET /api/obligations/:id/signals — fractional limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "50.5" },
      params: { id: VALID_OBLIGATION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalsForObligation>[0];
    const res = makeRes();

    await listSignalsForObligation(
      req,
      res as unknown as Parameters<typeof listSignalsForObligation>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    // The handler must short-circuit before hitting pg — no SQL must run.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /api/obligations/:id/signals — non-numeric limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "abc" },
      params: { id: VALID_OBLIGATION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalsForObligation>[0];
    const res = makeRes();

    await listSignalsForObligation(
      req,
      res as unknown as Parameters<typeof listSignalsForObligation>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ---- concurrent-insert cases ----

  it("POST /api/signal-obligation-links — INSERT happy path returns 201 created:true", async () => {
    const newLink = {
      id: VALID_LINK_UUID,
      organization_id: VALID_ORG_UUID,
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: null,
      created_by_user_id: null,
      created_at: "2026-05-05T00:00:00.000Z",
      deleted_at: null
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // obligation pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // signal pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [newLink] }); // INSERT success

    const req = {
      body: { signal_id: VALID_SIGNAL_UUID, obligation_id: VALID_OBLIGATION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createSignalObligationLink>[0];
    const res = makeRes();

    await createSignalObligationLink(
      req,
      res as unknown as Parameters<typeof createSignalObligationLink>[1]
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ link: newLink, created: true })
    );
    // 3 queries: obligation preflight, signal preflight, INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("POST /api/signal-obligation-links — ON CONFLICT path returns 200 created:false (no 500)", async () => {
    const existingLink = {
      id: VALID_LINK_UUID,
      organization_id: VALID_ORG_UUID,
      signal_id: VALID_SIGNAL_UUID,
      obligation_id: VALID_OBLIGATION_UUID,
      note: "previous link",
      created_by_user_id: null,
      created_at: "2026-05-02T10:00:00.000Z",
      deleted_at: null
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // obligation pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // signal pre-flight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })         // INSERT conflict
      .mockResolvedValueOnce({ rowCount: 1, rows: [existingLink] }); // SELECT existing

    const req = {
      body: { signal_id: VALID_SIGNAL_UUID, obligation_id: VALID_OBLIGATION_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createSignalObligationLink>[0];
    const res = makeRes();

    await createSignalObligationLink(
      req,
      res as unknown as Parameters<typeof createSignalObligationLink>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ link: existingLink, created: false })
    );
    // 4 queries: obligation preflight, signal preflight, INSERT (conflict), SELECT existing.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});
