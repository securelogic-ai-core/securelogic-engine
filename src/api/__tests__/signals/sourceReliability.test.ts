/**
 * sourceReliability.test.ts — Priority 4 / Phase 4B / B3.
 *
 * Covers the snapshot-proxy reliability scorer:
 *   - deterministic formula math (failure decay + light staleness),
 *   - cold-start → NULL (unknown, not zero),
 *   - flapping / never-succeeded behavior,
 *   - bounds + NUMERIC(5,2) shape,
 *   - the on-demand writer against an injected mock client (no DB), incl. the
 *     GLOBAL-only invariant (no organization_id in any SQL it issues), and
 *   - an inertness guard: no app-runtime module imports the scorer (B3 is
 *     consumed by nothing until B4).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  computeReliability,
  recomputeSourceReliability,
  RELIABILITY_STALENESS_FLOOR,
  type FeedHealthSnapshot,
  type Queryable
} from "../../lib/signals/sourceReliability.js";

const NOW = new Date("2026-06-27T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("computeReliability — formula (B3)", () => {
  it("scores a healthy source (0 failures, fresh success) at 100", () => {
    expect(computeReliability({ consecutiveFailures: 0, lastSuccessAt: NOW }, NOW)).toBe(100);
  });

  it("applies 0.6^consecutive_failures decay (fresh success)", () => {
    const fresh = (cf: number) => computeReliability({ consecutiveFailures: cf, lastSuccessAt: NOW }, NOW);
    expect(fresh(1)).toBe(60); // 100 * 0.6
    expect(fresh(2)).toBe(36); // 100 * 0.36
    expect(fresh(3)).toBe(21.6); // 100 * 0.216
  });

  it("applies a light staleness taper down to the floor at the horizon", () => {
    // cf=0 so decay=1.0; only staleness moves the score.
    expect(computeReliability({ consecutiveFailures: 0, lastSuccessAt: daysAgo(7) }, NOW)).toBe(85); // 1 - 0.3*0.5
    expect(computeReliability({ consecutiveFailures: 0, lastSuccessAt: daysAgo(14) }, NOW)).toBe(
      RELIABILITY_STALENESS_FLOOR * 100
    ); // 70
    expect(computeReliability({ consecutiveFailures: 0, lastSuccessAt: daysAgo(100) }, NOW)).toBe(70); // clamped at floor
  });

  it("treats a never-succeeded source (last_success_at NULL) as maximally stale, not cold-start", () => {
    // decay 0.36 * floor 0.7 = 25.2
    expect(computeReliability({ consecutiveFailures: 2, lastSuccessAt: null }, NOW)).toBe(25.2);
  });

  it("returns NULL for cold-start (no feed_health row) — unknown, not zero", () => {
    expect(computeReliability(null, NOW)).toBeNull();
  });

  it("stays within [0,100], ≤2dp, deterministic, and ≥0 for extreme failure counts", () => {
    const inputs: Array<FeedHealthSnapshot> = [
      { consecutiveFailures: 0, lastSuccessAt: NOW },
      { consecutiveFailures: 5, lastSuccessAt: daysAgo(3) },
      { consecutiveFailures: 50, lastSuccessAt: null },
      { consecutiveFailures: -3, lastSuccessAt: NOW } // guarded to 0
    ];
    for (const s of inputs) {
      const r = computeReliability(s, NOW)!;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(100);
      expect(Number(r.toFixed(2))).toBe(r); // no more than 2 decimals
      expect(computeReliability(s, NOW)).toBe(r); // deterministic
    }
    // negative cf guarded to 0 ⇒ same as a clean fresh source
    expect(computeReliability({ consecutiveFailures: -3, lastSuccessAt: NOW }, NOW)).toBe(100);
  });
});

/** Mock Queryable: returns seeded rows for the SELECT, records UPDATE params. */
function mockDb(selectRows: Array<Record<string, unknown>>) {
  const updates: Array<{ text: string; params: unknown[] }> = [];
  const allSql: string[] = [];
  const db: Queryable = {
    async query<T>(text: string, params?: unknown[]) {
      allSql.push(text);
      if (/UPDATE\s+sources/i.test(text)) {
        updates.push({ text, params: params ?? [] });
        return { rows: [] as T[] };
      }
      return { rows: selectRows as T[] };
    }
  };
  return { db, updates, allSql };
}

describe("recomputeSourceReliability — writer (B3)", () => {
  it("writes the computed reliability per source and reports counts", async () => {
    const { db, updates } = mockDb([
      { source: "nvd", consecutive_failures: 0, last_success_at: NOW }, // → 100
      { source: "krebsonsecurity", consecutive_failures: 1, last_success_at: NOW } // → 60
    ]);
    const res = await recomputeSourceReliability(db, NOW);
    expect(res).toEqual({ total: 2, updated: 2 });
    expect(updates.map((u) => u.params)).toEqual([
      [100, "nvd"],
      [60, "krebsonsecurity"]
    ]);
  });

  it("writes NULL reliability for a cold-start source (no feed_health row)", async () => {
    const { db, updates } = mockDb([
      { source: "mitre_atlas", consecutive_failures: null, last_success_at: null }
    ]);
    await recomputeSourceReliability(db, NOW);
    expect(updates[0].params).toEqual([null, "mitre_atlas"]);
  });

  it("issues only GLOBAL SQL — never references organization_id or RLS", async () => {
    const { db, allSql } = mockDb([
      { source: "nvd", consecutive_failures: 0, last_success_at: NOW }
    ]);
    await recomputeSourceReliability(db, NOW);
    for (const sql of allSql) {
      expect(sql).not.toMatch(/organization_id/i);
      expect(sql).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY/i);
    }
    // confirms the read is the cold-start-safe LEFT JOIN
    expect(allSql.some((s) => /LEFT JOIN feed_health/i.test(s))).toBe(true);
  });
});

describe("source reliability — consumers (B3 → B4)", () => {
  it("is imported only by the B4 brief-cycle recompute wiring (+ the on-demand script, excluded)", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const selfRel = "src/api/lib/signals/sourceReliability.ts";

    const tsFiles: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name.endsWith(".ts")) tsFiles.push(full);
      }
    };
    for (const root of ["src", "services"]) walk(path.join(repoRoot, root));

    const importers = tsFiles.filter((f) => {
      const rel = path.relative(repoRoot, f);
      if (rel === selfRel) return false; // the module itself
      if (/__tests__|\.test\.ts$|\.spec\.ts$/.test(rel)) return false; // this test
      return /sourceReliability/.test(readFileSync(f, "utf8"));
    });

    // B4 wires the recompute into the engine brief cycle (briefScheduler,
    // per-brief-cycle, flag-gated). That is the ONLY sanctioned app-runtime
    // consumer; scripts/ (on-demand entrypoint) is excluded above. Any OTHER
    // importer is an unexpected/early consumer.
    const rels = importers.map((f) => path.relative(repoRoot, f)).sort();
    expect(rels).toEqual(["src/api/lib/briefScheduler.ts"]);
  });
});
