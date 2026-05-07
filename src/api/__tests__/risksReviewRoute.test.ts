/**
 * RR-5 — Source-text + behavioral guards for POST /api/risks/:id/review.
 *
 * The review handler is registered inline on the risks router (default
 * Router export, no per-handler export), so the cheapest correctness
 * surface is source-text guards on src/api/routes/risks.ts:
 *
 *   - 404 path: cross-org and missing-row both rolled back + 404
 *   - reviewed_at: ISO date validation
 *   - note: type + length cap (≤ 500 chars)
 *   - cadence resolution chain: per-risk override > policy > defaults > FALLBACK
 *   - audit-event payload shape: 4 required keys + optional note
 *   - tenant scoping: org_id from req.organizationContext, never body
 *   - transactional FOR UPDATE locking on the risk row
 *
 * The cadence-resolution chain itself is covered by the resolveCadenceDays
 * unit assertions below (pure-function); this file verifies the route
 * calls the resolver with the right three arguments in the right order.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { resolveCadenceDays, FALLBACK_DAYS, DEFAULT_CADENCE_BY_RATING } from "../lib/riskCadence.js";

const ROUTE_FILE   = resolve(__dirname, "../routes/risks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

/**
 * Extract the source-text block for the POST /risks/:id/review handler.
 * Slice from its `router.post("/risks/:id/review", ...)` opener to the
 * START of the next router registration (or EOF). A naive non-greedy
 * match against `\)\;` fails because intra-handler statements end with
 * the same characters (`client.query("BEGIN");` etc.).
 */
function reviewRouteBlock(): string {
  const startRe = /router\.post\(\s*["']\/risks\/:id\/review["']/;
  const startMatch = ROUTE_SOURCE.match(startRe);
  if (!startMatch || startMatch.index === undefined) return "";
  const start = startMatch.index;
  const after = ROUTE_SOURCE.slice(start + startMatch[0].length);
  const nextRouteRe = /\nrouter\.(post|get|patch|delete|put)\(/;
  const nextMatch   = after.match(nextRouteRe);
  const end = nextMatch && nextMatch.index !== undefined
    ? start + startMatch[0].length + nextMatch.index
    : ROUTE_SOURCE.length;
  return ROUTE_SOURCE.slice(start, end);
}

const REVIEW_BLOCK = reviewRouteBlock();

// =====================================================================
// Route registration + middleware
// =====================================================================

describe("POST /api/risks/:id/review — registration & middleware", () => {
  it("the review-route block was extracted (sanity check)", () => {
    expect(REVIEW_BLOCK.length).toBeGreaterThan(500);
    expect(REVIEW_BLOCK).toMatch(/router\.post\(\s*["']\/risks\/:id\/review["']/);
  });

  it("uses the standard middleware chain (not admin-gated)", () => {
    expect(REVIEW_BLOCK).toMatch(/requireApiKey/);
    expect(REVIEW_BLOCK).toMatch(/attachOrganizationContext/);
    expect(REVIEW_BLOCK).toMatch(/requireEntitlement\(["']standard["']\)/);
    expect(REVIEW_BLOCK).not.toMatch(/requireAdminRole/);
  });
});

// =====================================================================
// Tenant scoping
// =====================================================================

describe("POST /api/risks/:id/review — tenant scoping", () => {
  it("never reads organization_id from req.body anywhere in routes/risks.ts", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });

  it("sources organizationId from req.organizationContext", () => {
    expect(REVIEW_BLOCK).toMatch(/organizationContext/);
  });

  it("returns 403 organization_context_missing when context is absent", () => {
    expect(REVIEW_BLOCK).toMatch(/organization_context_missing/);
    expect(REVIEW_BLOCK).toMatch(/status\(403\)/);
  });
});

// =====================================================================
// Body validation
// =====================================================================

describe("POST /api/risks/:id/review — body validation", () => {
  it("validates risk id is a UUID", () => {
    expect(REVIEW_BLOCK).toMatch(/risk_id_must_be_uuid/);
  });

  it("validates reviewed_at as an ISO date string when present", () => {
    expect(REVIEW_BLOCK).toMatch(/reviewed_at_must_be_iso_date/);
  });

  it("validates note as a string and caps length at 500", () => {
    expect(REVIEW_BLOCK).toMatch(/note_must_be_string/);
    expect(REVIEW_BLOCK).toMatch(/note_too_long/);
    expect(REVIEW_BLOCK).toMatch(/length\s*>\s*500/);
  });

  it("note length cap matches the documented contract (500 chars)", () => {
    // Defensive: any future tightening of the cap should also update
    // the audit-payload note semantics (note recorded only when
    // present — dropped silently otherwise).
    expect(REVIEW_BLOCK).toMatch(/note must be 500 characters or fewer/);
  });
});

// =====================================================================
// Transactional locking + 404 path
// =====================================================================

describe("POST /api/risks/:id/review — locking & 404", () => {
  it("opens a transaction and locks the risk row FOR UPDATE", () => {
    expect(REVIEW_BLOCK).toMatch(/await\s+pg\.connect\(\)/);
    expect(REVIEW_BLOCK).toMatch(/BEGIN/);
    expect(REVIEW_BLOCK).toMatch(
      /SELECT[\s\S]*?FROM risks\s+WHERE id = \$1 AND organization_id = \$2[\s\S]*?FOR UPDATE/
    );
  });

  it("returns 404 + ROLLBACK when the risk does not exist in this org", () => {
    // ROLLBACK appears alongside the 404 branch so the lock is released
    // before the response is sent.
    expect(REVIEW_BLOCK).toMatch(
      /ROLLBACK[\s\S]{0,300}status\(404\)[\s\S]{0,200}risk_not_found/
    );
  });

  it("commits before responding (commit ordering — never respond before COMMIT)", () => {
    const commitIdx = REVIEW_BLOCK.indexOf('client.query("COMMIT")');
    const okIdx     = REVIEW_BLOCK.indexOf("status(200)");
    expect(commitIdx).toBeGreaterThan(0);
    expect(okIdx).toBeGreaterThan(commitIdx);
  });

  it("releases the client in a finally block", () => {
    expect(REVIEW_BLOCK).toMatch(/finally\s*\{[\s\S]*?client\.release\(\)/);
  });
});

// =====================================================================
// Cadence resolution
// =====================================================================

describe("POST /api/risks/:id/review — cadence resolution", () => {
  it("calls resolveCadenceDays with (override, policy, residual_rating)", () => {
    const m = REVIEW_BLOCK.match(
      /resolveCadenceDays\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/
    );
    expect(m).not.toBeNull();
    expect(m![1]!).toMatch(/review_cadence_days/);
    expect(m![2]!).toMatch(/policy/);
    expect(m![3]!).toMatch(/residual_rating/);
  });

  it("queries org policy from risk_settings keyed on organization_id", () => {
    expect(REVIEW_BLOCK).toMatch(
      /SELECT cadence_by_rating[\s\S]*?FROM risk_settings[\s\S]*?WHERE organization_id\s*=\s*\$1/
    );
  });

  it("filters policy values to positive integers before passing to resolver", () => {
    // Defensive: jsonb stored arbitrary types — coerce to ints > 0.
    expect(REVIEW_BLOCK).toMatch(/Number\.isInteger/);
    expect(REVIEW_BLOCK).toMatch(/typeof v === ["']number["']/);
  });

  // Pure-function assertions on the resolver itself — anchors the
  // priority chain so a future regression in resolveCadenceDays is
  // caught here rather than only at the route boundary.
  it("resolveCadenceDays — per-risk override beats policy and defaults", () => {
    const result = resolveCadenceDays(7, { Critical: 30 }, "Critical");
    expect(result).toBe(7);
  });

  it("resolveCadenceDays — policy beats defaults when override is null", () => {
    const result = resolveCadenceDays(null, { Critical: 14 }, "Critical");
    expect(result).toBe(14);
  });

  it("resolveCadenceDays — defaults used when policy missing the key", () => {
    const result = resolveCadenceDays(null, { High: 45 }, "Critical");
    expect(result).toBe(DEFAULT_CADENCE_BY_RATING.Critical);
  });

  it("resolveCadenceDays — FALLBACK_DAYS when residual rating is null/unknown", () => {
    expect(resolveCadenceDays(null, null, null)).toBe(FALLBACK_DAYS);
    expect(resolveCadenceDays(null, null, "Bogus")).toBe(FALLBACK_DAYS);
  });
});

// =====================================================================
// Update query
// =====================================================================

describe("POST /api/risks/:id/review — UPDATE query", () => {
  it("writes last_reviewed_at = COALESCE($3::date, CURRENT_DATE)", () => {
    expect(REVIEW_BLOCK).toMatch(
      /last_reviewed_at\s*=\s*COALESCE\(\$3::date,\s*CURRENT_DATE\)/
    );
  });

  it("recomputes next_review_due using cadence_days_used", () => {
    expect(REVIEW_BLOCK).toMatch(
      /next_review_due\s*=\s*COALESCE\(\$3::date,\s*CURRENT_DATE\)\s*\+\s*\(\$4\s*\*\s*INTERVAL\s*'1 day'\)/
    );
  });

  it("UPDATE is org-scoped (id + organization_id)", () => {
    expect(REVIEW_BLOCK).toMatch(
      /UPDATE risks[\s\S]*?WHERE id = \$1 AND organization_id = \$2/
    );
  });
});

// =====================================================================
// Audit event shape
// =====================================================================

describe("POST /api/risks/:id/review — audit event shape", () => {
  it("emits a risk.reviewed event scoped to the risk", () => {
    expect(REVIEW_BLOCK).toMatch(/eventType:\s*["']risk\.reviewed["']/);
    expect(REVIEW_BLOCK).toMatch(/resourceType:\s*["']risk["']/);
    expect(REVIEW_BLOCK).toMatch(/resourceId:\s*riskId/);
  });

  it("payload contains the four documented keys", () => {
    const m = REVIEW_BLOCK.match(
      /eventType:\s*["']risk\.reviewed["'][\s\S]{0,800}?ipAddress/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/reviewed_at/);
    expect(block).toMatch(/next_review_due/);
    expect(block).toMatch(/cadence_days_used/);
    expect(block).toMatch(/source:\s*["']manual["']/);
  });

  it("note is included only when present (DEV-RR2)", () => {
    // Conditional-spread shape: ...(note ? { note } : {}). The exact
    // syntax is what guarantees no `note: null` lands in the payload.
    expect(REVIEW_BLOCK).toMatch(/\.\.\.\(note\s*\?\s*\{\s*note\s*\}\s*:\s*\{\}\)/);
  });

  it("captures actor + ip from the request", () => {
    const m = REVIEW_BLOCK.match(
      /writeAuditEvent\(\{[\s\S]{0,1500}?eventType:\s*["']risk\.reviewed["'][\s\S]{0,800}?\}\);/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/actorUserId:\s*req\.userId/);
    expect(block).toMatch(/actorApiKeyId/);
    expect(block).toMatch(/ipAddress:\s*req\.ip/);
  });
});

// =====================================================================
// Migration shape guard
// =====================================================================

const MIGRATION_FILE = resolve(
  __dirname,
  "../../../db/migrations/20260607_risk_review_cadence.sql"
);
const MIGRATION_SOURCE = readFileSync(MIGRATION_FILE, "utf8");

describe("risk_review_cadence migration", () => {
  it("adds the three review-cadence columns on risks", () => {
    expect(MIGRATION_SOURCE).toMatch(/last_reviewed_at\s+DATE/);
    expect(MIGRATION_SOURCE).toMatch(/next_review_due\s+DATE/);
    expect(MIGRATION_SOURCE).toMatch(/review_cadence_days\s+INTEGER/);
  });

  it("constrains review_cadence_days to be positive when set", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /review_cadence_days IS NULL OR review_cadence_days > 0/
    );
  });

  it("creates the partial index on (organization_id, next_review_due)", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_risks_org_next_review_due[\s\S]*next_review_due IS NOT NULL/
    );
  });

  it("creates the risk_settings table with UNIQUE organization_id", () => {
    expect(MIGRATION_SOURCE).toMatch(
      /CREATE TABLE IF NOT EXISTS risk_settings/
    );
    expect(MIGRATION_SOURCE).toMatch(/UNIQUE REFERENCES organizations\(id\)/);
  });

  it("declares cadence_by_rating as JSONB NOT NULL", () => {
    expect(MIGRATION_SOURCE).toMatch(/cadence_by_rating\s+JSONB\s+NOT NULL/);
  });
});
