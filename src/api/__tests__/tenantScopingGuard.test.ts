import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Narrow tenant-isolation guard.
 *
 * Asserts structural properties of a curated allowlist of customer-data
 * route files. Does NOT do repo-wide regex scanning.
 *
 * Maintenance: when a new customer-data route is introduced, add it to
 * CUSTOMER_DATA_ROUTES below. The classification of every non-org-scoped
 * route is recorded in TENANT_ROUTE_CLASSIFICATION.md.
 *
 * What this guard catches:
 *   - a customer-data route that loses requireApiKey or
 *     attachOrganizationContext from its middleware chain
 *   - a customer-data route whose source no longer contains the literal
 *     "organization_id" anywhere (i.e. its SQL stopped scoping by org)
 *
 * What this guard intentionally does not do:
 *   - parse SQL statements (brittle and false-positive prone)
 *   - scan repo-wide (would false-fire on global routes)
 *   - validate every WHERE clause individually (deferred to follow-on
 *     work; Postgres RLS is the structural defense the standard names)
 */

const ROUTES_DIR = resolve(__dirname, "../routes");

/**
 * Curated list of customer-data route files. Each file in this list MUST
 * scope its DB access by organization_id.
 *
 * Coverage chosen for this package:
 *   - alertPreferences.ts — fixed in tenant-isolation-enforcement
 *   - vendors.ts          — vendor primitive (canonical pattern)
 *   - risks.ts            — risk register primitive
 *   - evidence.ts         — evidence linkage primitive
 *   - intelligenceBriefs.ts — org-context route (brief generation)
 */
const CUSTOMER_DATA_ROUTES = [
  "alertPreferences.ts",
  "vendors.ts",
  "risks.ts",
  "evidence.ts",
  "intelligenceBriefs.ts"
];

function readRoute(file: string): string {
  return readFileSync(resolve(ROUTES_DIR, file), "utf8");
}

describe("tenant scoping guard — customer-data routes", () => {
  for (const file of CUSTOMER_DATA_ROUTES) {
    describe(file, () => {
      const source = readRoute(file);

      it("imports requireApiKey middleware", () => {
        expect(source).toMatch(/requireApiKey/);
      });

      it("imports attachOrganizationContext middleware", () => {
        expect(source).toMatch(/attachOrganizationContext/);
      });

      it("references organization_id in source", () => {
        // The standard requires every customer-data SQL clause to scope by
        // organization_id. We do not parse SQL; we assert the literal
        // appears somewhere in the file. A route that drops org scoping
        // entirely will fail this assertion.
        expect(source).toMatch(/organization_id/);
      });

      it("does not read organization_id from req.body", () => {
        // organization_id MUST come from req.organizationContext, never
        // from a client-supplied body. Catch the obvious anti-pattern.
        expect(source).not.toMatch(/req\.body\.organization_id/);
        expect(source).not.toMatch(/req\.body\?\.organization_id/);
      });
    });
  }
});

describe("alertPreferences.ts — tenant-isolation-enforcement fix", () => {
  const source = readRoute("alertPreferences.ts");

  it("derives organizationId from req.organizationContext, not body", () => {
    expect(source).toMatch(/organizationContext\?\.organizationId/);
  });

  it("returns 403 organization_context_missing when orgId is null", () => {
    expect(source).toMatch(/organization_context_missing/);
  });

  it("GET query joins user_id AND organization_id", () => {
    expect(source).toMatch(/WHERE user_id = \$1 AND organization_id = \$2/);
  });

  it("PATCH INSERT includes organization_id column", () => {
    expect(source).toMatch(/INSERT INTO user_alert_preferences \(user_id, organization_id/);
  });

  it("PATCH re-SELECT scopes by user_id AND organization_id", () => {
    expect(source).toMatch(/WHERE user_id = \$1 AND organization_id = \$2/);
  });
});
