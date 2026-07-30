/**
 * GET /api/evidence/recent (EG2 Tier 2 slice 8) — source-level pins, in the
 * same style as the kevPoller registration pins: the properties that make the
 * route safe are structural and cheap to verify against the source.
 *
 *  1. ORDER: "/evidence/recent" must register BEFORE "/evidence/:id" or the
 *     literal path is captured as an id and the page silently 404s/400s.
 *  2. SCOPE: the query is org-scoped and LIMIT-bounded (no unbounded reads).
 *  3. PROJECTION: it reuses EVIDENCE_SELECT — the raw storage key is never
 *     exposed on any list surface.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../routes/evidence.ts"),
  "utf-8"
);

describe("GET /api/evidence/recent — registration and shape", () => {
  it("registers before /evidence/:id so the literal path is never captured as an id", () => {
    const recentAt = src.indexOf('"/evidence/recent"');
    const byIdAt = src.indexOf('"/evidence/:id"');
    expect(recentAt).toBeGreaterThan(-1);
    expect(byIdAt).toBeGreaterThan(-1);
    expect(recentAt).toBeLessThan(byIdAt);
  });

  it("is org-scoped, LIMIT-bounded, and runs behind the full tenant chain", () => {
    const routeStart = src.indexOf('"/evidence/recent"');
    const routeSlice = src.slice(routeStart, routeStart + 2200);
    expect(routeSlice).toMatch(/requireApiKey/);
    expect(routeSlice).toMatch(/attachOrganizationContext/);
    expect(routeSlice).toMatch(/requireEntitlement\("premium"\)/);
    expect(routeSlice).toMatch(/asTenant\(/);
    expect(routeSlice).toMatch(/WHERE organization_id = \$1/);
    expect(routeSlice).toMatch(/LIMIT \$2/);
    // Clamp: caller can never demand more than 100 rows.
    expect(routeSlice).toMatch(/Math\.min\(rawLimit, 100\)/);
  });

  it("projects through EVIDENCE_SELECT — never the raw storage key", () => {
    const routeStart = src.indexOf('"/evidence/recent"');
    const routeSlice = src.slice(routeStart, routeStart + 2200);
    expect(routeSlice).toMatch(/\$\{EVIDENCE_SELECT\}/);
    expect(routeSlice).not.toMatch(/storage_key/);
  });
});
