/**
 * RR-3 — Source-text guards for the per-risk history endpoint.
 *
 * Mirrors the riskScoringWeights.test.ts source-text pattern: the
 * router module exports a default Router, not individual handlers,
 * so the cheapest behavioral assurance is to check that the route
 * source contains the structural pieces that make it correct.
 *
 * The route now delegates to the shared resourceHistory lib (the
 * pattern it originated). SQL-shape invariants — org scoping on every
 * branch, parent+org-scoped satellite subqueries, no deleted_at
 * filtering, parameterized ids — are pinned against RISK_HISTORY_SPEC
 * here and generically in resourceHistory.test.ts. What stays
 * risks-specific in this file:
 *   - the route exists at GET /risks/:id/history
 *   - middleware chain is the risk register's (premium, not admin-gated)
 *   - ownership-404 happens BEFORE the history fetch
 *   - delegation to fetchResourceHistory(RISK_HISTORY_SPEC)
 *   - RR-5 writer/reader event-type contract
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  RISK_HISTORY_SPEC,
  buildResourceHistoryWhere,
} from "../lib/resourceHistory.js";

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
    expect(block).toMatch(/requireEntitlement\(["']premium["']\)/);
    // Per-risk history must NOT be admin-gated — anyone with risk read
    // access should see the trail.
    expect(block).not.toMatch(/requireAdminRole/);
  });

  it("delegates to the shared reader with the risk spec", () => {
    const m = ROUTE_SOURCE.match(
      /router\.get\(\s*["']\/risks\/:id\/history["'][\s\S]{0,2400}/
    );
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/fetchResourceHistory\(/);
    expect(m![0]).toMatch(/RISK_HISTORY_SPEC/);
  });

  it("verifies risk ownership before returning history (no enumeration leak)", () => {
    // The route should 404 when the risk does not belong to the caller's
    // org rather than returning an empty events list (which would leak
    // existence by absence-of-404 vs error). The check must run BEFORE
    // the history fetch.
    const block = ROUTE_SOURCE.match(
      /router\.get\(\s*["']\/risks\/:id\/history["'][\s\S]{0,2400}/
    )![0];
    expect(block).toMatch(
      /SELECT 1 FROM risks WHERE id = \$1 AND organization_id = \$2/
    );
    expect(block).toMatch(/error:\s*["']risk_not_found["']/);
    // The 404 must come BEFORE the history fetch (order within the block).
    expect(block.indexOf("risk_not_found")).toBeLessThan(
      block.indexOf("fetchResourceHistory(")
    );
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });
});

describe("RISK_HISTORY_SPEC — the RR-3/RR-4/RR-6 scope, now spec-pinned", () => {
  const where = buildResourceHistoryWhere(RISK_HISTORY_SPEC);

  it("covers the root risk branch plus all three satellite branches", () => {
    expect(where).toContain(
      "(sal.resource_type = 'risk' AND sal.resource_id = $2::uuid)"
    );
    for (const sat of ["risk_treatment", "risk_control_link", "risk_obligation_link"]) {
      expect(where).toMatch(
        new RegExp(`sal\\.resource_type = '${sat}' AND sal\\.resource_id IN`)
      );
    }
  });

  it("every satellite subquery is parent-scoped AND org-scoped", () => {
    for (const table of ["risk_treatments", "risk_control_links", "risk_obligation_links"]) {
      expect(where).toMatch(
        new RegExp(
          `SELECT id FROM ${table}\\s+WHERE risk_id = \\$2::uuid AND organization_id = \\$1`
        )
      );
    }
  });

  it("never filters deleted_at (delete events stay visible after soft delete)", () => {
    expect(where).not.toContain("deleted_at");
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
    // Anchor on the resource_type='risk' branch of the spec-built WHERE
    // and verify it does NOT include an event_type filter — the branch
    // must be generic so every risk.* event lands in the history.
    const where = buildResourceHistoryWhere(RISK_HISTORY_SPEC);
    const m = where.match(
      /sal\.resource_type\s*=\s*'risk'\s+AND\s+sal\.resource_id\s*=\s*\$2::uuid[^\)]*/g
    );
    expect(m).not.toBeNull();
    expect(m!.length).toBe(1);
    expect(m![0]).not.toMatch(/event_type/);
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
