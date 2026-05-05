import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateSignalAiSystemLinkCreate,
  isUuid
} from "../lib/signalAiSystemLinkValidation.js";

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
const VALID_AI_SYSTEM_UUID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const VALID_ORG_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_LINK_UUID = "33333333-3333-4333-8333-333333333333";

// ====================================================================
// validateSignalAiSystemLinkCreate — body shape
// ====================================================================

describe("validateSignalAiSystemLinkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateSignalAiSystemLinkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateSignalAiSystemLinkCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateSignalAiSystemLinkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateSignalAiSystemLinkCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ====================================================================
// validateSignalAiSystemLinkCreate — signal_id
// ====================================================================

describe("validateSignalAiSystemLinkCreate — signal_id", () => {
  it("rejects missing signal_id", () => {
    const r = validateSignalAiSystemLinkCreate({ ai_system_id: VALID_AI_SYSTEM_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects empty signal_id", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: "   ",
      ai_system_id: VALID_AI_SYSTEM_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects numeric signal_id", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: 42,
      ai_system_id: VALID_AI_SYSTEM_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects non-UUID signal_id", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: "not-a-uuid",
      ai_system_id: VALID_AI_SYSTEM_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalAiSystemLinkCreate — ai_system_id
// ====================================================================

describe("validateSignalAiSystemLinkCreate — ai_system_id", () => {
  it("rejects missing ai_system_id", () => {
    const r = validateSignalAiSystemLinkCreate({ signal_id: VALID_SIGNAL_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects empty ai_system_id", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects non-UUID ai_system_id", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalAiSystemLinkCreate — note
// ====================================================================

describe("validateSignalAiSystemLinkCreate — note", () => {
  it("defaults note to null when omitted", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts a short note and trims it", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: "   ATLAS technique applies to our fraud-detection model  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(r.input.note).toBe("ATLAS technique applies to our fraud-detection model");
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: "   "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts explicit null note", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("rejects non-string note", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note longer than 500 chars", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: "a".repeat(501)
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note of exactly 500 chars", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: "a".repeat(500)
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note?.length).toBe(500);
  });
});

// ====================================================================
// validateSignalAiSystemLinkCreate — happy path
// ====================================================================

describe("validateSignalAiSystemLinkCreate — happy path", () => {
  it("returns trimmed signal_id and ai_system_id", () => {
    const r = validateSignalAiSystemLinkCreate({
      signal_id: `  ${VALID_SIGNAL_UUID}  `,
      ai_system_id: `  ${VALID_AI_SYSTEM_UUID}  `,
      note: "context"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.signal_id).toBe(VALID_SIGNAL_UUID);
      expect(r.input.ai_system_id).toBe(VALID_AI_SYSTEM_UUID);
      expect(r.input.note).toBe("context");
    }
  });

  it("ignores any organization_id value supplied in the body", () => {
    // The validator MUST NOT echo organization_id through. organization_id is
    // sourced exclusively from req.organizationContext at the route layer.
    const r = validateSignalAiSystemLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(
        ["ai_system_id", "note", "signal_id"].sort()
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
// Mirrors the tenantScopingGuard.test.ts and signalVendorLinks.test.ts
// pattern: assert structural invariants on the route source. The codebase
// has no HTTP test harness; introducing one here is architectural drift.
// Behavioral HTTP coverage is deferred to the BUILD_SEQUENCE.md backlog
// item "HTTP test harness for link routes" once all four link tables exist.
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/signalAiSystemLinks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("signalAiSystemLinks route — tenant isolation invariants", () => {
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
    expect(ROUTE_SOURCE).toMatch(/signal_ai_system_link\.created/);
    expect(ROUTE_SOURCE).toMatch(/signal_ai_system_link\.deleted/);
  });

  it("uses soft delete (deleted_at IS NULL) for live-link queries", () => {
    expect(ROUTE_SOURCE).toMatch(/deleted_at IS NULL/);
    expect(ROUTE_SOURCE).toMatch(/SET deleted_at = NOW\(\)/);
  });

  it("performs cross-row same-org pre-flight on AI system", () => {
    expect(ROUTE_SOURCE).toMatch(
      /FROM ai_systems WHERE id = \$1 AND organization_id = \$2/
    );
  });

  it("declares all four required endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.post\(\s*["']\/signal-ai-system-links["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.delete\(\s*["']\/signal-ai-system-links\/:id["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/ai-systems\/:id\/signals["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/cyber-signals\/:id\/ai-systems["']/
    );
  });

  it("scopes DELETE to organization_id (no IDOR)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE signal_ai_system_links[\s\S]*WHERE id = \$1[\s\S]*AND organization_id = \$2/
    );
  });

  it("returns 404 (not 403) on cross-org access — no enumeration", () => {
    expect(ROUTE_SOURCE).toMatch(/ai_system_not_found/);
    expect(ROUTE_SOURCE).toMatch(/cyber_signal_not_found/);
    expect(ROUTE_SOURCE).toMatch(/signal_ai_system_link_not_found/);
  });
});

// ====================================================================
// Global-signal asymmetry guard.
//
// Operator flag: explicitly assert that org-scoped ai_systems can be
// linked to global cyber_signals (organization_id IS NULL). This is the
// asymmetry between the two FK targets — vendors/ai_systems are always
// org-scoped; cyber_signals can be either org-scoped or global. The
// route MUST handle this in (a) the cross-row signal pre-flight on
// POST and (b) the listing query on GET /api/ai-systems/:id/signals
// so global-linked signals are returned alongside org-scoped ones.
// ====================================================================

describe("signalAiSystemLinks route — global cyber_signals (organization_id IS NULL) path", () => {
  it("POST signal pre-flight permits global signals", () => {
    // The pre-flight on the POST handler must accept either same-org OR
    // global (NULL-org) signals. Without "OR organization_id IS NULL", a
    // user trying to link a CISA KEV / NVD / MITRE ATLAS public signal to
    // their AI system would get cyber_signal_not_found.
    expect(ROUTE_SOURCE).toMatch(
      /FROM cyber_signals[\s\S]*WHERE id = \$1[\s\S]*AND \(organization_id = \$2 OR organization_id IS NULL\)/
    );
  });

  it("GET /api/ai-systems/:id/signals returns same-org AND global signals via the JOIN filter", () => {
    // The JOIN onto cyber_signals must also pass through global signals,
    // not only same-org ones. Without the OR-NULL clause in this WHERE,
    // a vendor's link to a global signal would silently disappear from
    // listings — a user-visible bug.
    expect(ROUTE_SOURCE).toMatch(
      /FROM signal_ai_system_links sasl[\s\S]*JOIN cyber_signals cs[\s\S]*WHERE[\s\S]*\(cs\.organization_id = \$1 OR cs\.organization_id IS NULL\)/
    );
  });

  it("GET /api/cyber-signals/:id/ai-systems pre-flight permits global signals", () => {
    // Reverse direction: when listing AI systems for a cyber signal, the
    // signal itself may be global. Pre-flight must accept that case so a
    // user can read back which AI systems they linked to a public signal.
    expect(ROUTE_SOURCE).toMatch(
      /FROM cyber_signals[\s\S]*WHERE id = \$1[\s\S]*AND \(organization_id = \$2 OR organization_id IS NULL\)/
    );
  });

  it("documents the asymmetry with an inline comment naming the standard", () => {
    // Future-Claude reading this file should understand WHY the signal
    // pre-flight is asymmetric. Comment must reference the standard.
    expect(ROUTE_SOURCE).toMatch(/global[\s\S]*organization_id IS NULL[\s\S]*§1|TENANT_ISOLATION_STANDARD\.md §1/);
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260504_signal_ai_system_links.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("signal_ai_system_links migration", () => {
  it("creates the signal_ai_system_links table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS signal_ai_system_links/
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

  it("ai_system_id references ai_systems(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /ai_system_id\s+UUID\s+NOT NULL\s+REFERENCES ai_systems\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("declares deleted_at for soft delete", () => {
    expect(MIGRATION_SOURCE).toMatch(/deleted_at\s+TIMESTAMPTZ\s+NULL/);
  });

  it("creates a partial unique index keyed on (org, signal, ai_system) WHERE deleted_at IS NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_ai_system_links_unique_active[\s\S]*\(organization_id, signal_id, ai_system_id\)[\s\S]*WHERE deleted_at IS NULL/
    );
  });

  it("creates the per-AI-system and per-signal hot-read indexes", () => {
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_ai_system_links_org_ai_system/);
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_ai_system_links_org_signal/);
  });

  it("does not alter cyber_signals, ai_systems, findings, or risks", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE cyber_signals/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE ai_systems/);
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
  createSignalAiSystemLink,
  listSignalsForAiSystem
} from "../routes/signalAiSystemLinks.js";

const mockQuery = pg.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("signalAiSystemLinks — behavioral edge cases", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ---- parseLimit cases ----

  it("GET /api/ai-systems/:id/signals — fractional limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "50.5" },
      params: { id: VALID_AI_SYSTEM_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalsForAiSystem>[0];
    const res = makeRes();

    await listSignalsForAiSystem(
      req,
      res as unknown as Parameters<typeof listSignalsForAiSystem>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    // The handler must short-circuit before hitting pg — no SQL must run.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /api/ai-systems/:id/signals — non-numeric limit returns 400 invalid_limit", async () => {
    const req = {
      query: { limit: "abc" },
      params: { id: VALID_AI_SYSTEM_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID }
    } as unknown as Parameters<typeof listSignalsForAiSystem>[0];
    const res = makeRes();

    await listSignalsForAiSystem(
      req,
      res as unknown as Parameters<typeof listSignalsForAiSystem>[1]
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "invalid_limit" })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ---- concurrent-insert cases ----

  it("POST /api/signal-ai-system-links — INSERT happy path returns 201 created:true", async () => {
    const newLink = {
      id: VALID_LINK_UUID,
      organization_id: VALID_ORG_UUID,
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: null,
      created_by_user_id: null,
      created_at: "2026-05-04T22:00:00.000Z",
      deleted_at: null
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // ai_system pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] }) // signal pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [newLink] }); // INSERT success

    const req = {
      body: { signal_id: VALID_SIGNAL_UUID, ai_system_id: VALID_AI_SYSTEM_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createSignalAiSystemLink>[0];
    const res = makeRes();

    await createSignalAiSystemLink(
      req,
      res as unknown as Parameters<typeof createSignalAiSystemLink>[1]
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ link: newLink, created: true })
    );
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("POST /api/signal-ai-system-links — ON CONFLICT path returns 200 created:false (no 500)", async () => {
    const existingLink = {
      id: VALID_LINK_UUID,
      organization_id: VALID_ORG_UUID,
      signal_id: VALID_SIGNAL_UUID,
      ai_system_id: VALID_AI_SYSTEM_UUID,
      note: "previous link",
      created_by_user_id: null,
      created_at: "2026-05-01T10:00:00.000Z",
      deleted_at: null
    };
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // ai_system pre-flight
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })       // signal pre-flight
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })         // INSERT conflict
      .mockResolvedValueOnce({ rowCount: 1, rows: [existingLink] }); // SELECT existing

    const req = {
      body: { signal_id: VALID_SIGNAL_UUID, ai_system_id: VALID_AI_SYSTEM_UUID },
      organizationContext: { organizationId: VALID_ORG_UUID },
      ip: "127.0.0.1"
    } as unknown as Parameters<typeof createSignalAiSystemLink>[0];
    const res = makeRes();

    await createSignalAiSystemLink(
      req,
      res as unknown as Parameters<typeof createSignalAiSystemLink>[1]
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ link: existingLink, created: false })
    );
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});
