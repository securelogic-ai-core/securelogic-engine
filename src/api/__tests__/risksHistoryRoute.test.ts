/**
 * RR-3 — Source-text guards for the per-risk history endpoint.
 *
 * Mirrors the riskScoringWeights.test.ts source-text pattern: the
 * router module exports a default Router, not individual handlers,
 * so the cheapest behavioral assurance is to check that the route
 * source contains the structural pieces that make it correct.
 *
 * What we guard:
 *   - the route exists at GET /risks/:id/history
 *   - middleware chain is the standard one (not admin-gated)
 *   - WHERE clause covers BOTH 'risk' and 'risk_treatment' resource_types
 *   - treatment subquery is org-scoped
 *   - LIMIT and OFFSET are parameterized (not interpolated)
 *   - ORDER BY is created_at DESC, id DESC (stable pagination)
 *   - response shape returns { events, total_count, limit, offset }
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROUTE_FILE   = resolve(__dirname, "../routes/risks.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("GET /api/risks/:id/history — source guards", () => {
  it("declares the route", () => {
    expect(ROUTE_SOURCE).toMatch(
      /router\.get\(\s*["']\/risks\/:id\/history["']/
    );
  });

  it("uses the standard middleware chain (not admin-gated)", () => {
    // Locate the route registration and the next ~600 chars of args.
    const m = ROUTE_SOURCE.match(
      /router\.get\(\s*["']\/risks\/:id\/history["'][\s\S]{0,800}/
    );
    expect(m).not.toBeNull();
    const block = m![0];
    expect(block).toMatch(/requireApiKey/);
    expect(block).toMatch(/attachOrganizationContext/);
    expect(block).toMatch(/requireEntitlement\(["']standard["']\)/);
    // Per-risk history must NOT be admin-gated — anyone with risk read
    // access should see the trail.
    expect(block).not.toMatch(/requireAdminRole/);
  });

  it("queries security_audit_log with org scope and BOTH resource types", () => {
    expect(ROUTE_SOURCE).toMatch(/FROM security_audit_log sal/);
    expect(ROUTE_SOURCE).toMatch(/sal\.organization_id\s*=\s*\$1/);
    expect(ROUTE_SOURCE).toMatch(
      /sal\.resource_type\s*=\s*'risk'\s+AND\s+sal\.resource_id\s*=\s*\$2::uuid/
    );
    expect(ROUTE_SOURCE).toMatch(
      /sal\.resource_type\s*=\s*'risk_treatment'\s+AND\s+sal\.resource_id\s+IN/
    );
  });

  it("treatment subquery is scoped to the parent risk AND the org", () => {
    // Subquery must filter risk_id (parent) AND organization_id so a
    // treatment that somehow ended up in another org cannot leak in.
    const subqueryMatch = ROUTE_SOURCE.match(
      /SELECT id FROM risk_treatments\s+WHERE risk_id\s*=\s*\$2::uuid\s+AND organization_id\s*=\s*\$1/
    );
    expect(subqueryMatch).not.toBeNull();
  });

  // RR-4 — link-event branch in the OR clause
  it("includes the risk_control_link branch (RR-4)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /sal\.resource_type\s*=\s*'risk_control_link'\s+AND\s+sal\.resource_id\s+IN/
    );
  });

  it("link subquery is org-scoped to the parent risk", () => {
    // Same shape as the treatment subquery — risk_id + organization_id.
    const subqueryMatch = ROUTE_SOURCE.match(
      /SELECT id FROM risk_control_links\s+WHERE risk_id\s*=\s*\$2::uuid\s+AND organization_id\s*=\s*\$1/
    );
    expect(subqueryMatch).not.toBeNull();
  });

  it("link subquery does NOT filter on deleted_at (delete events stay visible)", () => {
    // Critical: filtering on deleted_at IS NULL would hide .deleted events
    // the moment they fire, defeating the audit trail. Match the link
    // subquery and assert deleted_at does not appear inside it.
    const linkSubqueries = ROUTE_SOURCE.match(
      /SELECT id FROM risk_control_links\s+WHERE risk_id\s*=\s*\$2::uuid\s+AND organization_id\s*=\s*\$1[^)]*/g
    );
    expect(linkSubqueries).not.toBeNull();
    expect(linkSubqueries!.length).toBe(2); // events query + count query
    for (const sub of linkSubqueries!) {
      expect(sub).not.toMatch(/deleted_at/);
    }
  });

  // RR-6 — fourth OR branch for risk_obligation_link
  it("includes the risk_obligation_link branch (RR-6)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /sal\.resource_type\s*=\s*'risk_obligation_link'\s+AND\s+sal\.resource_id\s+IN/
    );
  });

  it("obligation-link subquery is org-scoped to the parent risk", () => {
    const subqueryMatch = ROUTE_SOURCE.match(
      /SELECT id FROM risk_obligation_links\s+WHERE risk_id\s*=\s*\$2::uuid\s+AND organization_id\s*=\s*\$1/
    );
    expect(subqueryMatch).not.toBeNull();
  });

  it("obligation-link subquery does NOT filter on deleted_at", () => {
    // Same rationale as the control-link branch — keep .deleted events
    // visible after soft delete.
    const subqueries = ROUTE_SOURCE.match(
      /SELECT id FROM risk_obligation_links\s+WHERE risk_id\s*=\s*\$2::uuid\s+AND organization_id\s*=\s*\$1[^)]*/g
    );
    expect(subqueries).not.toBeNull();
    expect(subqueries!.length).toBe(2); // events query + count query
    for (const sub of subqueries!) {
      expect(sub).not.toMatch(/deleted_at/);
    }
  });

  it("LEFT JOINs users for actor display fields", () => {
    expect(ROUTE_SOURCE).toMatch(/LEFT JOIN users u ON u\.id\s*=\s*sal\.actor_user_id/);
    expect(ROUTE_SOURCE).toMatch(/u\.email\s+AS actor_email/);
    expect(ROUTE_SOURCE).toMatch(/u\.name\s+AS actor_name/);
  });

  it("aliases payload as metadata so the frontend renderer is reusable", () => {
    expect(ROUTE_SOURCE).toMatch(/sal\.payload\s+AS metadata/);
  });

  it("orders DESC by created_at then id (stable pagination)", () => {
    expect(ROUTE_SOURCE).toMatch(
      /ORDER BY sal\.created_at DESC, sal\.id DESC/
    );
  });

  it("LIMIT and OFFSET are parameterized", () => {
    expect(ROUTE_SOURCE).toMatch(/LIMIT \$3 OFFSET \$4/);
  });

  it("verifies risk ownership before returning history (no enumeration leak)", () => {
    // The route should 404 when the risk does not belong to the caller's
    // org rather than returning an empty events list (which would leak
    // existence by absence-of-404 vs error).
    expect(ROUTE_SOURCE).toMatch(
      /SELECT 1 FROM risks WHERE id = \$1 AND organization_id = \$2/
    );
    expect(ROUTE_SOURCE).toMatch(/error:\s*["']risk_not_found["']/);
  });

  it("returns the documented response shape", () => {
    expect(ROUTE_SOURCE).toMatch(/events:\s*eventsResult\.rows/);
    expect(ROUTE_SOURCE).toMatch(/total_count/);
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });
});

// =====================================================================
// RR-5 — risk.reviewed events surface in per-risk history
// =====================================================================
//
// The history endpoint matches on resource_type='risk' AND resource_id =
// riskId. The POST /api/risks/:id/review handler writes audit events
// with exactly that resource_type/resource_id pair, so they're picked
// up by the existing branch — no route code change needed for RR-5.
// This test asserts the visibility invariant by checking:
//
//   1. The history WHERE clause for resource_type='risk' is generic on
//      event_type — it does NOT filter by event_type, so any
//      risk.* event lands in the history.
//   2. The review handler writes resource_type='risk' (not, e.g., a
//      separate 'risk_review' resource_type) so the existing history
//      query catches it.
//
// If either invariant changes (e.g., review writes resource_type=
// 'risk_review' to disambiguate), the history endpoint would need a
// fifth OR branch — these tests pin the contract.

describe("GET /api/risks/:id/history — RR-5 risk.reviewed visibility", () => {
  it("history WHERE clause matches all event_type values for resource_type='risk'", () => {
    // Anchor on the resource_type='risk' branch and verify it does
    // NOT include an event_type filter — the branch must be generic.
    const m = ROUTE_SOURCE.match(
      /sal\.resource_type\s*=\s*'risk'\s+AND\s+sal\.resource_id\s*=\s*\$2::uuid[^\)]*/g
    );
    expect(m).not.toBeNull();
    expect(m!.length).toBe(2); // events query + count query
    for (const branch of m!) {
      expect(branch).not.toMatch(/event_type/);
    }
  });

  it("review handler writes resource_type='risk' (not a separate review-specific resource type)", () => {
    // The history endpoint's existing 'risk' branch only catches review
    // events if the writer uses resource_type='risk'. Pin that contract.
    const m = ROUTE_SOURCE.match(
      /eventType:\s*["']risk\.reviewed["'][\s\S]{0,400}?resourceType:\s*["']risk["']/
    );
    expect(m).not.toBeNull();
  });

  it("review handler writes resourceId = riskId (so history query joins on riskId)", () => {
    const m = ROUTE_SOURCE.match(
      /eventType:\s*["']risk\.reviewed["'][\s\S]{0,400}?resourceId:\s*riskId/
    );
    expect(m).not.toBeNull();
  });
});

describe("PATCH /api/risks/:id — RR-3 fix 1.2 audit payload diffs", () => {
  it("locks the row using RISK_SELECT to capture all before-values", () => {
    // The PATCH handler used to SELECT only id/inherent_rating/residual_rating.
    // After RR-3 it must SELECT every diffable column so the audit
    // payload can emit per-field { before, after } pairs.
    expect(ROUTE_SOURCE).toMatch(
      /SELECT \$\{RISK_SELECT\}\s+FROM risks WHERE id = \$1 AND organization_id = \$2 FOR UPDATE/
    );
  });

  it("declares the DIFFABLE_FIELDS constant covering all mutable columns", () => {
    const m = ROUTE_SOURCE.match(/const DIFFABLE_FIELDS\s*=\s*\[([\s\S]*?)\] as const;/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    for (const f of [
      "title", "description", "domain",
      "likelihood", "impact", "risk_rating",
      "inherent_likelihood", "inherent_impact", "inherent_rating",
      "residual_likelihood", "residual_impact", "residual_rating",
      "status", "treatment", "owner", "owner_user_id",
      "due_date", "source_type", "source_id",
      // RR-5 — per-risk cadence override is PATCH-able and must
      // appear in the diff payload for audit visibility.
      "review_cadence_days"
    ]) {
      expect(body).toContain(`"${f}"`);
    }
  });

  it("emits a `diffs` map alongside the legacy `fields` array", () => {
    // Back-compat: keep `fields: Object.keys(input)` so existing readers
    // of the audit payload don't break. New `diffs` provides per-field
    // before/after.
    expect(ROUTE_SOURCE).toMatch(/fields:\s*Object\.keys\(input\)/);
    expect(ROUTE_SOURCE).toMatch(/diffs/);
  });
});
