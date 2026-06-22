import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateSignalControlLinkCreate,
  isUuid
} from "../lib/signalControlLinkValidation.js";

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
const VALID_CONTROL_UUID = "d4e5f6a7-b8c9-0123-defa-2345678901ab";
const VALID_ORG_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_LINK_UUID = "44444444-4444-4444-8444-444444444444";

// ====================================================================
// validateSignalControlLinkCreate — body shape
// ====================================================================

describe("validateSignalControlLinkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateSignalControlLinkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateSignalControlLinkCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateSignalControlLinkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateSignalControlLinkCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ====================================================================
// validateSignalControlLinkCreate — signal_id
// ====================================================================

describe("validateSignalControlLinkCreate — signal_id", () => {
  it("rejects missing signal_id", () => {
    const r = validateSignalControlLinkCreate({ control_id: VALID_CONTROL_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects empty signal_id", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: "   ",
      control_id: VALID_CONTROL_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects numeric signal_id", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: 42,
      control_id: VALID_CONTROL_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects non-UUID signal_id", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: "not-a-uuid",
      control_id: VALID_CONTROL_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalControlLinkCreate — control_id
// ====================================================================

describe("validateSignalControlLinkCreate — control_id", () => {
  it("rejects missing control_id", () => {
    const r = validateSignalControlLinkCreate({ signal_id: VALID_SIGNAL_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects empty control_id", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects non-UUID control_id", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalControlLinkCreate — note
// ====================================================================

describe("validateSignalControlLinkCreate — note", () => {
  it("defaults note to null when omitted", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts a short note and trims it", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: "   CISA advisory exercises our MFA control  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(r.input.note).toBe("CISA advisory exercises our MFA control");
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: "   "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts explicit null note", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("rejects non-string note", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note longer than 500 chars", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: "a".repeat(501)
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note of exactly 500 chars", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: "a".repeat(500)
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note?.length).toBe(500);
  });
});

// ====================================================================
// validateSignalControlLinkCreate — happy path
// ====================================================================

describe("validateSignalControlLinkCreate — happy path", () => {
  it("returns trimmed signal_id and control_id", () => {
    const r = validateSignalControlLinkCreate({
      signal_id: `  ${VALID_SIGNAL_UUID}  `,
      control_id: `  ${VALID_CONTROL_UUID}  `,
      note: "context"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.signal_id).toBe(VALID_SIGNAL_UUID);
      expect(r.input.control_id).toBe(VALID_CONTROL_UUID);
      expect(r.input.note).toBe("context");
    }
  });

  it("ignores any organization_id value supplied in the body", () => {
    // The validator MUST NOT echo organization_id through. organization_id is
    // sourced exclusively from req.organizationContext at the route layer.
    const r = validateSignalControlLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(
        ["control_id", "note", "signal_id"].sort()
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
// assert structural invariants on the route source. The codebase has
// minimal-scope direct-handler behavioral tests at the bottom of this
// file for two specific edge cases (parseLimit + ON CONFLICT). Full
// HTTP test harness remains in BUILD_SEQUENCE.md backlog.
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/signalControlLinks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("signalControlLinks route — tenant isolation invariants", () => {
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

  it("audit-logs via writeAuditEvent for create and delete", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/signal_control_link\.created/);
    expect(ROUTE_SOURCE).toMatch(/signal_control_link\.deleted/);
  });

  it("uses soft delete (deleted_at IS NULL) for live-link queries", () => {
    expect(ROUTE_SOURCE).toMatch(/deleted_at IS NULL/);
    expect(ROUTE_SOURCE).toMatch(/SET deleted_at = NOW\(\)/);
  });

  it("performs cross-row same-org pre-flight on control", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM controls WHERE id = \$1 AND organization_id = \$2/
    );
  });

  it("declares all four required endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.post\(\s*["']\/signal-control-links["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.delete\(\s*["']\/signal-control-links\/:id["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/controls\/:id\/signals["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/cyber-signals\/:id\/controls["']/
    );
  });

  it("scopes DELETE to organization_id (no IDOR)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE signal_control_links[\s\S]*WHERE id = \$1[\s\S]*AND organization_id = \$2/
    );
  });

  it("returns 404 (not 403) on cross-org access — no enumeration", () => {
    expect(ROUTE_SOURCE).toMatch(/control_not_found/);
    expect(ROUTE_SOURCE).toMatch(/cyber_signal_not_found/);
    expect(ROUTE_SOURCE).toMatch(/signal_control_link_not_found/);
  });

  it("uses ON CONFLICT inference against the partial unique index (hardened template)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ON CONFLICT \(organization_id, signal_id, control_id\)[\s\S]*WHERE deleted_at IS NULL[\s\S]*DO NOTHING/
    );
  });
});

// ====================================================================
// Global-signal asymmetry guard.
//
// Asserts org-scoped controls can be linked to global cyber_signals
// (organization_id IS NULL). Public-source threat signals (CISA KEV,
// NVD, MITRE ATT&CK) are visible to every org and may be linked to any
// org's controls. The route MUST handle this in (a) the cross-row
// signal pre-flight on POST, (b) the listing query on
// GET /api/controls/:id/signals, and (c) the pre-flight on the reverse
// listing GET /api/cyber-signals/:id/controls.
// ====================================================================

describe("signalControlLinks route — global cyber_signals (organization_id IS NULL) path", () => {
  it("POST signal pre-flight permits global signals", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM cyber_signals[\s\S]*WHERE id = \$1[\s\S]*AND \(organization_id = \$2 OR organization_id IS NULL\)/
    );
  });

  it("GET /api/controls/:id/signals returns same-org AND global signals via the JOIN filter", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM signal_control_links scl[\s\S]*JOIN cyber_signals cs[\s\S]*WHERE[\s\S]*\(cs\.organization_id = \$1 OR cs\.organization_id IS NULL\)/
    );
  });

  it("GET /api/cyber-signals/:id/controls pre-flight permits global signals", () => {
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
  "../../../db/migrations/20260504_signal_control_links.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("signal_control_links migration", () => {
  it("creates the signal_control_links table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS signal_control_links/
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

  it("control_id references controls(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /control_id\s+UUID\s+NOT NULL\s+REFERENCES controls\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("declares deleted_at for soft delete", () => {
    expect(MIGRATION_SOURCE).toMatch(/deleted_at\s+TIMESTAMPTZ\s+NULL/);
  });

  it("creates a partial unique index keyed on (org, signal, control) WHERE deleted_at IS NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_control_links_unique_active[\s\S]*\(organization_id, signal_id, control_id\)[\s\S]*WHERE deleted_at IS NULL/
    );
  });

  it("creates the per-control and per-signal hot-read indexes", () => {
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_control_links_org_control/);
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_control_links_org_signal/);
  });

  it("does not alter cyber_signals, controls, findings, or risks", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE cyber_signals/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE controls/);
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
// The full HTTP test harness remains in BUILD_SEQUENCE.md backlog (see
// "HTTP test harness for link routes"). DO NOT extend behavioral
// coverage piecemeal here — backfill via the harness package once all
// four link tables (vendor, AI system, control, obligation) are in
// place. The scope of this section is fixed at 4 cases per route.
//
// Mocks: pg.query and writeAuditEvent. Handlers are imported by name
// from the route file (which exports them for direct invocation).
// ====================================================================

import { pg } from "../infra/postgres.js";
import {
  createSignalControlLink,
  listSignalsForControl
} from "../routes/signalControlLinks.js";

const mockQuery = pg.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("signalControlLinks — behavioral edge cases", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ---- parseLimit cases ----

  it("GET /api/controls/:id/signals — fractional limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "50.5" },
      params: { id: VALID_CONTROL_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalsForControl>[0];
    const res = makeRes();

    await listSignalsForControl(
      req,
      res as unknown as Parameters<typeof listSignalsForControl>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    // The handler must short-circuit before hitting pg — no SQL must run.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /api/controls/:id/signals — non-numeric limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "abc" },
      params: { id: VALID_CONTROL_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalsForControl>[0];
    const res = makeRes();

    await listSignalsForControl(
      req,
      res as unknown as Parameters<typeof listSignalsForControl>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ---- concurrent-insert cases ----

  it("POST /api/signal-control-links — INSERT happy path returns 201 created:true", async () => {
    const newLink = {
      id: VALID_LINK_UUID,
      organization_id: VALID_ORG_UUID,
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: null,
      created_by_user_id: null,
      created_at: "2026-05-04T22:00:00.000Z",
      deleted_at: null
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // control pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // signal pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [newLink] }); // INSERT success

    const req = {
      body: { signal_id: VALID_SIGNAL_UUID, control_id: VALID_CONTROL_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createSignalControlLink>[0];
    const res = makeRes();

    await createSignalControlLink(
      req,
      res as unknown as Parameters<typeof createSignalControlLink>[1]
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ link: newLink, created: true })
    );
    // 3 queries: control preflight, signal preflight, INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("POST /api/signal-control-links — ON CONFLICT path returns 200 created:false (no 500)", async () => {
    const existingLink = {
      id: VALID_LINK_UUID,
      organization_id: VALID_ORG_UUID,
      signal_id: VALID_SIGNAL_UUID,
      control_id: VALID_CONTROL_UUID,
      note: "previous link",
      created_by_user_id: null,
      created_at: "2026-05-01T10:00:00.000Z",
      deleted_at: null
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // control pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // signal pre-flight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })         // INSERT conflict
      .mockResolvedValueOnce({ rowCount: 1, rows: [existingLink] }); // SELECT existing

    const req = {
      body: { signal_id: VALID_SIGNAL_UUID, control_id: VALID_CONTROL_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createSignalControlLink>[0];
    const res = makeRes();

    await createSignalControlLink(
      req,
      res as unknown as Parameters<typeof createSignalControlLink>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ link: existingLink, created: false })
    );
    // 4 queries: control preflight, signal preflight, INSERT (conflict), SELECT existing.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});
