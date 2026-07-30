/**
 * Source-text guards for the per-finding history endpoint plus
 * spec-level assertions on FINDING_HISTORY_SPEC — the risksHistoryRoute
 * pattern. Findings can't join the shared ROUTES guard table in
 * resourceHistory.test.ts because its gate is requireEntitlement
 * ("premium"), not requirePremiumOrCorePlatform.
 *
 * The finding spec is the first to use a polymorphic satellite:
 * actions reference their origin via (source_type, source_id), so the
 * subquery must pin source_type = 'finding'. Without that pin, an
 * action spawned by a signal whose source_id collided with this
 * finding's id would leak into the trail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  FINDING_HISTORY_SPEC,
  buildResourceHistoryWhere,
} from "../lib/resourceHistory.js";

const ROUTE_FILE   = resolve(__dirname, "../routes/findings.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_FILE, "utf8");

describe("GET /api/findings/:id/history — source guards", () => {
  const block = ROUTE_SOURCE.match(
    /router\.get\(\s*["']\/findings\/:id\/history["'][\s\S]{0,2400}/
  );

  it("declares the route", () => {
    expect(block).not.toBeNull();
  });

  it("uses the finding register's chain (premium, tenant-wrapped, not admin-gated)", () => {
    const b = block![0];
    expect(b).toMatch(/requireApiKey/);
    expect(b).toMatch(/attachOrganizationContext/);
    expect(b).toMatch(/requireEntitlement\(["']premium["']\)/);
    expect(b).toMatch(/asTenant\(/);
    expect(b).not.toMatch(/requireAdminRole/);
  });

  it("verifies finding ownership and 404s BEFORE the history fetch", () => {
    const b = block![0];
    expect(b).toMatch(
      /SELECT 1 FROM findings WHERE id = \$1 AND organization_id = \$2/
    );
    expect(b).toMatch(/error:\s*["']finding_not_found["']/);
    expect(b.indexOf("finding_not_found")).toBeLessThan(
      b.indexOf("fetchResourceHistory(")
    );
  });

  it("delegates to the shared reader with the finding spec", () => {
    expect(block![0]).toMatch(/fetchResourceHistory\(/);
    expect(block![0]).toMatch(/FINDING_HISTORY_SPEC/);
  });

  it("never reads organization_id from req.body", () => {
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\.organization_id/);
    expect(ROUTE_SOURCE).not.toMatch(/req\.body\?\.organization_id/);
  });
});

describe("FINDING_HISTORY_SPEC — polymorphic action satellite", () => {
  const where = buildResourceHistoryWhere(FINDING_HISTORY_SPEC);

  it("covers the root finding branch plus both satellites", () => {
    expect(where).toContain(
      "(sal.resource_type = 'finding' AND sal.resource_id = $2::uuid)"
    );
    expect(where).toMatch(
      /sal\.resource_type = 'finding_risk_acceptance' AND sal\.resource_id IN/
    );
    expect(where).toMatch(/sal\.resource_type = 'action' AND sal\.resource_id IN/);
  });

  it("acceptance subquery is parent-scoped AND org-scoped", () => {
    expect(where).toMatch(
      /SELECT id FROM finding_risk_acceptances\s+WHERE finding_id = \$2::uuid AND organization_id = \$1/
    );
  });

  it("action subquery pins source_type='finding' alongside source_id + org", () => {
    expect(where).toMatch(
      /SELECT id FROM actions\s+WHERE source_id = \$2::uuid AND organization_id = \$1 AND source_type = 'finding'/
    );
  });

  it("uses only the two positional parameters (extraWhere adds none)", () => {
    const params = new Set(where.match(/\$\d+/g));
    expect([...params].sort()).toEqual(["$1", "$2"]);
  });

  it("never filters deleted_at", () => {
    expect(where).not.toContain("deleted_at");
  });
});
