import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  FINDING_SOURCE_TYPES,
  USER_CREATABLE_SOURCE_TYPES,
  FINDING_STATUSES,
  validateFindingCreate,
} from "../lib/findingValidation.js";

/**
 * Finding vocabulary contract (#693, defect D-15).
 *
 * The DB CHECK allows 15 source_type values; the validator and two
 * route-local copies each carried a different subset (11, 10, and 9 values),
 * so findings created by the engine's own writers (cyber_signal,
 * applicability_assessment, asset_assessment, intelligence_event) could not
 * be filtered by source through the public list or export APIs.
 *
 * Contracts pinned here:
 *  1. FINDING_SOURCE_TYPES == the DB CHECK, parsed from the migration itself
 *     — the sets cannot drift apart silently again.
 *  2. The create path stays NARROWER by design: engine-written types are
 *     rejected on POST /api/findings (a user must not be able to mint a
 *     finding that impersonates pipeline provenance).
 *  3. The list and export routes consume the canonical sets instead of
 *     declaring local copies.
 */

const MIGRATION = readFileSync(
  resolve(__dirname, "../../../db/migrations/20260823_findings_intelligence_event.sql"),
  "utf8"
);

function parseCheckValues(sql: string): Set<string> {
  const checkIdx = sql.indexOf("findings_source_type_check");
  const start = sql.indexOf("CHECK (source_type IN (", checkIdx);
  const end = sql.indexOf("));", start);
  const block = sql.slice(start, end);
  const values = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  return new Set(values);
}

describe("D-15: filter vocabulary == DB CHECK", () => {
  it("FINDING_SOURCE_TYPES matches the migration CHECK exactly", () => {
    const dbSet = parseCheckValues(MIGRATION);
    expect(dbSet.size).toBe(15);
    expect([...FINDING_SOURCE_TYPES].sort()).toEqual([...dbSet].sort());
  });

  it("includes the four engine-written types the old copies dropped", () => {
    for (const t of [
      "cyber_signal",
      "applicability_assessment",
      "asset_assessment",
      "intelligence_event",
    ]) {
      expect(FINDING_SOURCE_TYPES.has(t)).toBe(true);
    }
  });
});

describe("create path stays narrower than the filter path", () => {
  it("USER_CREATABLE_SOURCE_TYPES is a strict subset of FINDING_SOURCE_TYPES", () => {
    for (const t of USER_CREATABLE_SOURCE_TYPES) {
      expect(FINDING_SOURCE_TYPES.has(t)).toBe(true);
    }
    expect(USER_CREATABLE_SOURCE_TYPES.size).toBeLessThan(FINDING_SOURCE_TYPES.size);
  });

  it("POST validation rejects engine-written source types", () => {
    for (const t of [
      "cyber_signal",
      "applicability_assessment",
      "asset_assessment",
      "intelligence_event",
    ]) {
      const result = validateFindingCreate({
        title: "t",
        severity: "High",
        source_type: t,
        description: "d",
      });
      expect(result).toHaveProperty("error", "invalid_source_type");
    }
  });

  it("POST validation still accepts every user-creatable type", () => {
    for (const t of USER_CREATABLE_SOURCE_TYPES) {
      const result = validateFindingCreate({
        title: "t",
        severity: "High",
        source_type: t,
        description: "d",
      });
      expect(result).not.toHaveProperty("error", "invalid_source_type");
    }
  });
});

describe("routes consume the canonical sets (no local copies)", () => {
  const FINDINGS = readFileSync(resolve(__dirname, "../routes/findings.ts"), "utf8");
  const EXPORT = readFileSync(resolve(__dirname, "../routes/findingsExport.ts"), "utf8");

  it("findings.ts imports FINDING_SOURCE_TYPES and declares no source-type list", () => {
    expect(FINDINGS).toMatch(/FINDING_SOURCE_TYPES/);
    expect(FINDINGS).not.toMatch(/VALID_SOURCE_TYPES = new Set\(/);
  });

  it("findingsExport.ts imports every filter vocabulary and declares none", () => {
    expect(EXPORT).toMatch(/from "\.\.\/lib\/findingValidation\.js"/);
    expect(EXPORT).not.toMatch(/= new Set\(\[/);
  });

  it("export status filter now covers the full governed axis (incl. accepted)", () => {
    expect(FINDING_STATUSES.has("accepted")).toBe(true);
    expect(EXPORT).toMatch(/VALID_STATUSES = FINDING_STATUSES/);
  });
});
