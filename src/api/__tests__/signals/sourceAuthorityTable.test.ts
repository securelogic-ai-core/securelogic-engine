/**
 * sourceAuthorityTable.test.ts — Priority 4 / Phase 4B / B2 drift guard.
 *
 * B2 seeds static authority onto the `sources` table from a hand-written SQL
 * migration (db/migrations/20260708_sources_authority.sql) whose values mirror
 * the canonical TS map (src/api/lib/signals/sourceAuthority.ts). Three things
 * must stay aligned and nothing keeps them in sync at runtime:
 *   1. the TS map covers every live registry source,
 *   2. every value is within the table's CHECK bounds + controlled vocabulary,
 *   3. the SQL UPDATEs exactly mirror the TS map (a typo'd id would make an
 *      UPDATE silently no-op and leave authority NULL — caught here).
 *
 * No database is touched: this parses the migration text and compares it to the
 * imported registries + map, so it runs in the plain `test` lane.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { API_SOURCES } from "../../lib/signals/sourceRegistry.js";
import { FEEDS } from "../../lib/feedAdapter/registry.js";
import {
  SOURCE_AUTHORITY,
  type SourceAuthority
} from "../../lib/signals/sourceAuthority.js";

const MIGRATION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../db/migrations/20260708_sources_authority.sql"
);

const VOCAB: ReadonlySet<SourceAuthority> = new Set([
  "government",
  "standards_body",
  "research",
  "security_press"
]);

/** Pull every (source, authority, authority_tier) tuple from the UPDATE block. */
function parseUpdates(
  sql: string
): Array<{ source: string; authority: string; tier: number }> {
  const rows: Array<{ source: string; authority: string; tier: number }> = [];
  const re =
    /UPDATE\s+sources\s+SET\s+authority\s*=\s*'([a-z_]+)'\s*,\s*authority_tier\s*=\s*(\d+)\s+WHERE\s+source\s*=\s*'([a-z0-9_]+)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    rows.push({ source: m[3], authority: m[1], tier: Number(m[2]) });
  }
  return rows;
}

const sql = readFileSync(MIGRATION_PATH, "utf8");
const updates = parseUpdates(sql);

// DDL only (comment lines stripped) so prose naming organization_id / RLS in the
// header does not register as actual schema.
const ddl = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// The live registry id-set (api half + rss half) — the population target.
const registryIds = new Set<string>();
for (const s of API_SOURCES) registryIds.add(s.id);
for (const f of FEEDS) registryIds.add(f.id);

describe("source authority — TS map coverage + bounds (B2)", () => {
  it("covers every live registry source (13: 7 api + 6 rss)", () => {
    expect(registryIds.size).toBe(13);
    const mapped = new Set(Object.keys(SOURCE_AUTHORITY));
    const missing = [...registryIds].filter((id) => !mapped.has(id)).sort();
    const extra = [...mapped].filter((id) => !registryIds.has(id)).sort();
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("tags every authority with a controlled-vocabulary value", () => {
    for (const [id, rec] of Object.entries(SOURCE_AUTHORITY)) {
      expect(VOCAB.has(rec.authority), id).toBe(true);
    }
  });

  it("keeps every authority_tier within the table CHECK bounds (1..5)", () => {
    for (const [id, rec] of Object.entries(SOURCE_AUTHORITY)) {
      expect(rec.authorityTier, id).toBeGreaterThanOrEqual(1);
      expect(rec.authorityTier, id).toBeLessThanOrEqual(5);
    }
  });
});

describe("source authority — migration ↔ TS map parity (B2)", () => {
  it("updates exactly the 13 mapped sources (no missing, no extra, no dupes)", () => {
    const updatedIds = updates.map((u) => u.source);
    expect(new Set(updatedIds).size).toBe(updatedIds.length); // no duplicate UPDATEs
    expect(updatedIds.sort()).toEqual(Object.keys(SOURCE_AUTHORITY).sort());
  });

  it("seeds each source with the exact authority + tier from the TS map", () => {
    for (const u of updates) {
      const rec = SOURCE_AUTHORITY[u.source];
      expect(rec, u.source).toBeDefined();
      expect(u.authority, u.source).toBe(rec.authority);
      expect(u.tier, u.source).toBe(rec.authorityTier);
    }
  });
});

describe("source authority — migration invariants (B2)", () => {
  it("declares the controlled-vocabulary CHECK constraint", () => {
    expect(ddl).toMatch(/sources_authority_vocab_check/);
    expect(ddl).toMatch(/authority IN/i);
  });

  it("adds the constraint idempotently (guarded against re-run)", () => {
    expect(sql).toMatch(/IF NOT EXISTS/i);
    expect(sql).toMatch(/pg_constraint/);
  });

  it("documents the reversal (authority NULL + DROP CONSTRAINT)", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS sources_authority_vocab_check/);
    expect(sql).toMatch(/authority\s*=\s*NULL/i);
  });

  it("stays GLOBAL — no organization_id, no RLS, no policy", () => {
    expect(ddl).not.toMatch(/organization_id/i);
    expect(ddl).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(ddl).not.toMatch(/CREATE POLICY/i);
  });
});
