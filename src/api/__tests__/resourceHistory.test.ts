/**
 * resourceHistory — unit guards for the shared per-object audit-trail
 * reader and the register endpoints that consume it (risks pinned
 * separately in risksHistoryRoute.test.ts — its gate differs).
 *
 * Two layers:
 *  1. Pure assertions on buildResourceHistoryWhere / the parsers —
 *     org scoping on every branch, parent+org scoping on every
 *     satellite subquery, no caller input in identifiers.
 *  2. Source-text guards on the four route files (the
 *     risksHistoryRoute.test.ts pattern): route exists, standard
 *     non-admin middleware chain, ownership pre-check before the
 *     history query, canonical 404 error name.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  AI_SYSTEM_HISTORY_SPEC,
  CONTROL_HISTORY_SPEC,
  FINDING_HISTORY_SPEC,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  OBLIGATION_HISTORY_SPEC,
  RISK_HISTORY_SPEC,
  VENDOR_HISTORY_SPEC,
  buildResourceHistoryWhere,
  isHistoryUuid,
  parseHistoryLimit,
  parseHistoryOffset,
} from "../lib/resourceHistory.js";

// ─── Parsers ────────────────────────────────────────────────────────────────

describe("history paging parsers", () => {
  it("limit defaults, floors, and caps", () => {
    expect(parseHistoryLimit(undefined)).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryLimit("")).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryLimit("0")).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryLimit("-5")).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryLimit("abc")).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryLimit("7.9")).toBe(7);
    expect(parseHistoryLimit("1000")).toBe(HISTORY_MAX_LIMIT);
  });

  it("offset defaults and floors", () => {
    expect(parseHistoryOffset(undefined)).toBe(0);
    expect(parseHistoryOffset("-1")).toBe(0);
    expect(parseHistoryOffset("abc")).toBe(0);
    expect(parseHistoryOffset("12.7")).toBe(12);
  });

  it("isHistoryUuid accepts canonical UUIDs only", () => {
    expect(isHistoryUuid("2cac787c-e1f7-4bf0-81f3-acd9ef9eeb94")).toBe(true);
    expect(isHistoryUuid("2CAC787C-E1F7-4BF0-81F3-ACD9EF9EEB94")).toBe(true);
    expect(isHistoryUuid("not-a-uuid")).toBe(false);
    expect(isHistoryUuid("")).toBe(false);
    expect(isHistoryUuid(null)).toBe(false);
    expect(isHistoryUuid("2cac787c-e1f7-4bf0-81f3-acd9ef9eeb94; DROP")).toBe(false);
  });
});

// ─── WHERE builder ──────────────────────────────────────────────────────────

const ALL_SPECS = [
  ["risk", RISK_HISTORY_SPEC],
  ["finding", FINDING_HISTORY_SPEC],
  ["vendor", VENDOR_HISTORY_SPEC],
  ["control", CONTROL_HISTORY_SPEC],
  ["obligation", OBLIGATION_HISTORY_SPEC],
  ["ai_system", AI_SYSTEM_HISTORY_SPEC],
] as const;

describe("buildResourceHistoryWhere", () => {
  it.each(ALL_SPECS)("%s: org-scopes the whole clause and the root branch", (_name, spec) => {
    const where = buildResourceHistoryWhere(spec);
    expect(where).toContain("sal.organization_id = $1");
    expect(where).toContain(
      `(sal.resource_type = '${spec.rootType}' AND sal.resource_id = $2::uuid)`
    );
  });

  it.each(ALL_SPECS)("%s: every satellite subquery is parent-scoped AND org-scoped", (_name, spec) => {
    const where = buildResourceHistoryWhere(spec);
    for (const s of spec.satellites) {
      const re = new RegExp(
        `sal\\.resource_type = '${s.resourceType}' AND sal\\.resource_id IN \\(\\s*` +
          `SELECT id FROM ${s.table}\\s+` +
          `WHERE ${s.fkColumn} = \\$2::uuid AND organization_id = \\$1`
      );
      expect(where).toMatch(re);
    }
  });

  it("uses only the two positional parameters (no interpolated ids)", () => {
    for (const [, spec] of ALL_SPECS) {
      const where = buildResourceHistoryWhere(spec);
      const params = new Set(where.match(/\$\d+/g));
      expect([...params].sort()).toEqual(["$1", "$2"]);
    }
  });

  it("satellite subqueries never filter deleted_at (audit trail survives soft-delete)", () => {
    for (const [, spec] of ALL_SPECS) {
      expect(buildResourceHistoryWhere(spec)).not.toContain("deleted_at");
    }
  });
});

// ─── Route source guards ────────────────────────────────────────────────────

const ROUTES: Array<{
  file: string;
  path: string;
  ownershipTable: string;
  notFound: string;
}> = [
  { file: "vendors.ts", path: "/vendors/:id/history", ownershipTable: "vendors", notFound: "vendor_not_found" },
  { file: "controls.ts", path: "/controls/:id/history", ownershipTable: "controls", notFound: "control_not_found" },
  { file: "obligations.ts", path: "/obligations/:id/history", ownershipTable: "obligations", notFound: "obligation_not_found" },
  { file: "aiSystems.ts", path: "/ai-systems/:id/history", ownershipTable: "ai_systems", notFound: "ai_system_not_found" },
];

// ─── AI governance assessment audit emission ────────────────────────────────
// The ai_governance_assessment satellite in AI_SYSTEM_HISTORY_SPEC is only
// meaningful if the route actually writes audit rows (it wrote none before
// this suite existed). Guard both mutations.

describe("aiGovernanceAssessments.ts emits audit events", () => {
  const source = readFileSync(
    resolve(__dirname, "../routes/aiGovernanceAssessments.ts"),
    "utf8"
  );

  it("POST create writes ai_governance_assessment.created", () => {
    expect(source).toContain('eventType: "ai_governance_assessment.created"');
  });

  it("PATCH transition writes ai_governance_assessment.updated", () => {
    expect(source).toContain('eventType: "ai_governance_assessment.updated"');
  });

  it("both events carry the satellite resource type", () => {
    const count = source.split('resourceType: "ai_governance_assessment"').length - 1;
    expect(count).toBe(2);
  });
});

describe("register history routes — source guards", () => {
  for (const r of ROUTES) {
    const source = readFileSync(resolve(__dirname, "../routes", r.file), "utf8");
    const esc = r.path.replace(/[/:]/g, (c) => `\\${c}`);
    const block = source.match(
      new RegExp(`router\\.get\\(\\s*["']${esc}["'][\\s\\S]{0,2400}`)
    );

    describe(r.path, () => {
      it("declares the route", () => {
        expect(block).not.toBeNull();
      });

      it("uses the standard non-admin chain with the register's gate", () => {
        const b = block![0];
        expect(b).toMatch(/requireApiKey/);
        expect(b).toMatch(/attachOrganizationContext/);
        expect(b).toMatch(/requirePremiumOrCorePlatform/);
        expect(b).toMatch(/asTenant\(/);
        expect(b).not.toMatch(/requireAdminRole/);
      });

      it("verifies ownership (org-scoped) and 404s before reading history", () => {
        const b = block![0];
        expect(b).toMatch(
          new RegExp(
            `SELECT 1 FROM ${r.ownershipTable} WHERE id = \\$1 AND organization_id = \\$2`
          )
        );
        expect(b).toContain(r.notFound);
        // Ownership check must appear before the history fetch.
        expect(b.indexOf(r.notFound)).toBeLessThan(b.indexOf("fetchResourceHistory"));
      });

      it("delegates to the shared reader with the register's spec", () => {
        expect(block![0]).toMatch(/fetchResourceHistory\(/);
        expect(block![0]).toMatch(/_HISTORY_SPEC/);
      });
    });
  }
});
