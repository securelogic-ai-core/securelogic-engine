import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateSignalVendorLinkCreate,
  isUuid
} from "../lib/signalVendorLinkValidation.js";

const VALID_SIGNAL_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_VENDOR_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ====================================================================
// validateSignalVendorLinkCreate — body shape
// ====================================================================

describe("validateSignalVendorLinkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateSignalVendorLinkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateSignalVendorLinkCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateSignalVendorLinkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects undefined body", () => {
    const r = validateSignalVendorLinkCreate(undefined);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ====================================================================
// validateSignalVendorLinkCreate — signal_id
// ====================================================================

describe("validateSignalVendorLinkCreate — signal_id", () => {
  it("rejects missing signal_id", () => {
    const r = validateSignalVendorLinkCreate({ vendor_id: VALID_VENDOR_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects empty signal_id", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: "   ",
      vendor_id: VALID_VENDOR_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects numeric signal_id", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: 42,
      vendor_id: VALID_VENDOR_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_required");
  });

  it("rejects non-UUID signal_id", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: "not-a-uuid",
      vendor_id: VALID_VENDOR_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("signal_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalVendorLinkCreate — vendor_id
// ====================================================================

describe("validateSignalVendorLinkCreate — vendor_id", () => {
  it("rejects missing vendor_id", () => {
    const r = validateSignalVendorLinkCreate({ signal_id: VALID_SIGNAL_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects empty vendor_id", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects non-UUID vendor_id", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid");
  });
});

// ====================================================================
// validateSignalVendorLinkCreate — note
// ====================================================================

describe("validateSignalVendorLinkCreate — note", () => {
  it("defaults note to null when omitted", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts a short note and trims it", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      note: "   relevant to our payment processor exposure  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(r.input.note).toBe("relevant to our payment processor exposure");
  });

  it("normalizes whitespace-only note to null", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      note: "   "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("accepts explicit null note", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      note: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note).toBeNull();
  });

  it("rejects non-string note", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      note: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_must_be_string");
  });

  it("rejects note longer than 500 chars", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      note: "a".repeat(501)
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("note_too_long");
  });

  it("accepts note of exactly 500 chars", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      note: "a".repeat(500)
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.note?.length).toBe(500);
  });
});

// ====================================================================
// validateSignalVendorLinkCreate — happy path
// ====================================================================

describe("validateSignalVendorLinkCreate — happy path", () => {
  it("returns trimmed signal_id and vendor_id", () => {
    const r = validateSignalVendorLinkCreate({
      signal_id: `  ${VALID_SIGNAL_UUID}  `,
      vendor_id: `  ${VALID_VENDOR_UUID}  `,
      note: "context"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.signal_id).toBe(VALID_SIGNAL_UUID);
      expect(r.input.vendor_id).toBe(VALID_VENDOR_UUID);
      expect(r.input.note).toBe("context");
    }
  });

  it("ignores any organization_id value supplied in the body", () => {
    // The validator MUST NOT echo organization_id through. organization_id is
    // sourced exclusively from req.organizationContext at the route layer.
    const r = validateSignalVendorLinkCreate({
      signal_id: VALID_SIGNAL_UUID,
      vendor_id: VALID_VENDOR_UUID,
      organization_id: "00000000-0000-0000-0000-000000000000"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(Object.keys(r.input).sort()).toEqual(
        ["note", "signal_id", "vendor_id"].sort()
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
// Mirrors the tenantScopingGuard.test.ts pattern: assert structural
// invariants on the route source rather than running HTTP integration.
// The codebase has no HTTP test harness; introducing one is out of
// scope for this package.
// ====================================================================

const ROUTE_FILE = resolve(__dirname, "../routes/signalVendorLinks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("signalVendorLinks route — tenant isolation invariants", () => {
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
    // Customer-data tables are scoped by organization_id per
    // TENANT_ISOLATION_STANDARD.md §4.
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

  it("audit-logs via writeAuditEvent", () => {
    expect(ROUTE_SOURCE).toMatch(/writeAuditEvent/);
    expect(ROUTE_SOURCE).toMatch(/signal_vendor_link\.created/);
    expect(ROUTE_SOURCE).toMatch(/signal_vendor_link\.deleted/);
  });

  it("uses soft delete (deleted_at IS NULL) for live-link queries", () => {
    expect(ROUTE_SOURCE).toMatch(/deleted_at IS NULL/);
    // DELETE handler sets deleted_at = NOW() rather than physically removing.
    expect(ROUTE_SOURCE).toMatch(/SET deleted_at = NOW\(\)/);
  });

  it("performs cross-row same-org pre-flight on vendor", () => {
    // Standard §4: cross-row references must be verified same-org at the app layer.
    expect(ROUTE_SOURCE).toMatch(
      /FROM vendors WHERE id = \$1 AND organization_id = \$2/
    );
  });

  it("permits global signals (organization_id IS NULL) when checking signal ownership", () => {
    // Global, public-source cyber signals are explicitly cross-org-visible
    // per TENANT_ISOLATION_STANDARD.md §1.
    expect(ROUTE_SOURCE).toMatch(
      /organization_id = \$2 OR organization_id IS NULL/
    );
  });

  it("declares all four required endpoints", () => {
    expect(ROUTE_SOURCE).toMatch(/router\.post\(\s*["']\/signal-vendor-links["']/);
    expect(ROUTE_SOURCE).toMatch(
      /router\.delete\(\s*["']\/signal-vendor-links\/:id["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/vendors\/:id\/signals["']/
    );
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/cyber-signals\/:id\/vendors["']/
    );
  });

  it("scopes DELETE to organization_id (no IDOR)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /UPDATE signal_vendor_links[\s\S]*WHERE id = \$1[\s\S]*AND organization_id = \$2/
    );
  });

  it("returns 404 (not 403) on cross-org access — no enumeration", () => {
    // The route uses 404 for both vendor_not_found and cyber_signal_not_found
    // when the resource exists but belongs to a different org, matching the
    // standard's enumeration-resistance posture.
    expect(ROUTE_SOURCE).toMatch(/vendor_not_found/);
    expect(ROUTE_SOURCE).toMatch(/cyber_signal_not_found/);
    expect(ROUTE_SOURCE).toMatch(/signal_vendor_link_not_found/);
  });
});

// ====================================================================
// Migration shape guard
// ====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260504_signal_vendor_links.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("signal_vendor_links migration", () => {
  it("creates the signal_vendor_links table", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS signal_vendor_links/
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

  it("vendor_id references vendors(id) ON DELETE CASCADE", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /vendor_id\s+UUID\s+NOT NULL\s+REFERENCES vendors\(id\)\s+ON DELETE CASCADE/
    );
  });

  it("declares deleted_at for soft delete", () => {
    expect(MIGRATION_SOURCE).toMatch(/deleted_at\s+TIMESTAMPTZ\s+NULL/);
  });

  it("creates a partial unique index keyed on (org, signal, vendor) WHERE deleted_at IS NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_vendor_links_unique_active[\s\S]*\(organization_id, signal_id, vendor_id\)[\s\S]*WHERE deleted_at IS NULL/
    );
  });

  it("creates the per-vendor and per-signal hot-read indexes", () => {
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_vendor_links_org_vendor/);
    expect(MIGRATION_SOURCE).toMatch(/idx_signal_vendor_links_org_signal/);
  });

  it("does not alter cyber_signals, vendors, findings, or risks", () => {
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE cyber_signals/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE vendors/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE findings/);
    expect(MIGRATION_SOURCE).not.toMatch(/ALTER TABLE risks/);
  });
});
