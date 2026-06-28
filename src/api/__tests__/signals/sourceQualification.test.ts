/**
 * sourceQualification.test.ts — Priority 4 / Phase 4B / B4.
 *
 * Covers the qualification flag, the global-only loader, and the factor-4
 * priority function (authority_tier × reliability, NULL → authority-only,
 * unmapped → legacy fallback). The ranking-integration proof (flag-off ==
 * pre-B4 ordering) lives in intelligenceBriefRanking.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  sourceQualificationEnabled,
  loadSourceQualification,
  makeQualificationPriority,
  type Queryable,
  type QualificationRecord
} from "../../lib/signals/sourceQualification.js";

describe("sourceQualificationEnabled — flag (B4)", () => {
  it("is true ONLY when the env var === 'true' (OFF everywhere by default)", () => {
    expect(sourceQualificationEnabled({ SECURELOGIC_SOURCE_QUALIFICATION_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "false", "1", "TRUE", "yes"]) {
      expect(
        sourceQualificationEnabled({ SECURELOGIC_SOURCE_QUALIFICATION_ENABLED: v as string })
      ).toBe(false);
    }
    expect(sourceQualificationEnabled({})).toBe(false); // not on in dev/test either
  });
});

/** Mock Queryable returning fixed rows and recording the SQL issued. */
function mockDb(rows: Array<Record<string, unknown>>) {
  const sqls: string[] = [];
  const db: Queryable = {
    async query<T>(text: string) {
      sqls.push(text);
      return { rows: rows as T[] };
    }
  };
  return { db, sqls };
}

describe("loadSourceQualification — global loader (B4)", () => {
  it("builds a normalized map and coerces reliability; skips null authority_tier", async () => {
    const { db } = mockDb([
      { source: "nvd", authority_tier: 1, reliability: "87.50" },
      { source: "KrebsOnSecurity", authority_tier: 3, reliability: null }, // cold-start + mixed case
      { source: "ghost", authority_tier: null, reliability: 50 } // not qualified — skipped
    ]);
    const map = await loadSourceQualification(db);
    expect(map.get("nvd")).toEqual({ authorityTier: 1, reliability: 87.5 });
    expect(map.get("krebsonsecurity")).toEqual({ authorityTier: 3, reliability: null });
    expect(map.has("ghost")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("issues GLOBAL-only SQL — no organization_id, reads sources", async () => {
    const { db, sqls } = mockDb([]);
    await loadSourceQualification(db);
    expect(sqls[0]).not.toMatch(/organization_id/i);
    expect(sqls[0]).toMatch(/FROM\s+sources/i);
  });
});

describe("makeQualificationPriority — factor-4 ordinal (B4)", () => {
  const legacy = vi.fn((s: string) => (s === "nvd" ? 1 : 5));
  const map = new Map<string, QualificationRecord>([
    ["nvd", { authorityTier: 1, reliability: 50 }],
    ["cisa_alerts", { authorityTier: 1, reliability: 95 }],
    ["mitre_attack", { authorityTier: 2, reliability: null }],
    ["krebsonsecurity", { authorityTier: 3, reliability: 90 }]
  ]);
  const priority = makeQualificationPriority(map, legacy);

  it("combines authority_tier with a small reliability tie-break (tier − reliability/1000)", () => {
    expect(priority("nvd")).toBeCloseTo(1 - 0.05, 6); // 0.95
    expect(priority("krebsonsecurity")).toBeCloseTo(3 - 0.09, 6); // 2.91
  });

  it("keeps authority_tier dominant — a tier-1 source always beats a tier-2/3", () => {
    expect(priority("cisa_alerts")).toBeLessThan(priority("mitre_attack"));
    expect(priority("nvd")).toBeLessThan(priority("krebsonsecurity"));
  });

  it("within a tier, higher reliability sorts earlier (smaller priority)", () => {
    // both tier 1; cisa_alerts rel 95 > nvd rel 50 ⇒ cisa_alerts ranks first
    expect(priority("cisa_alerts")).toBeLessThan(priority("nvd"));
  });

  it("treats NULL reliability as authority-only (no penalty, no bonus)", () => {
    expect(priority("mitre_attack")).toBe(2); // exactly the tier, not 2 - something
  });

  it("falls back to the legacy ordinal for an unmapped source", () => {
    legacy.mockClear();
    expect(priority("totally_unknown_source")).toBe(5);
    expect(legacy).toHaveBeenCalledWith("totally_unknown_source");
  });

  it("matches map keys case-insensitively (same normalization as legacy)", () => {
    expect(priority("NVD")).toBeCloseTo(0.95, 6); // hits the 'nvd' entry, not legacy
  });
});
