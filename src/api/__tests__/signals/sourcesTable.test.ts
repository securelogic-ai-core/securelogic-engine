/**
 * sourcesTable.test.ts — Priority 4 / Phase 4B / B1 drift guard.
 *
 * The `sources` table (db/migrations/20260707_sources.sql) seeds one row per
 * upstream signal source, keyed by the canonical source id and tagged with its
 * kind. That seed list is hand-written SQL; the live registries are TypeScript.
 * Nothing at runtime keeps them in sync, so this test fails loudly the moment
 * they diverge — e.g. a source added to a registry but not the table, or a
 * kind mismatch.
 *
 * No database is touched: this parses the migration text and compares it to the
 * imported registries, so it runs in the plain `test` lane (not isolation).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { API_SOURCES } from "../../lib/signals/sourceRegistry.js";
import { FEEDS } from "../../lib/feedAdapter/registry.js";

// Resolve the migration relative to this test file (src/api/__tests__/signals → repo root).
const MIGRATION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../db/migrations/20260707_sources.sql"
);

/** Pull every ('<source>', '<kind>') tuple out of the backfill VALUES block. */
function parseSeededRows(sql: string): Array<{ source: string; kind: string }> {
  // Scope to the INSERT block only, so the CHECK (kind IN ('api','rss'))
  // constraint tuple in CREATE TABLE is not mistaken for a seeded row.
  const insertBlock = sql.slice(sql.indexOf("INSERT INTO sources"));
  const rows: Array<{ source: string; kind: string }> = [];
  const re = /\(\s*'([a-z0-9_]+)'\s*,\s*'(api|rss)'\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(insertBlock)) !== null) {
    rows.push({ source: m[1], kind: m[2] });
  }
  return rows;
}

const sql = readFileSync(MIGRATION_PATH, "utf8");
const seeded = parseSeededRows(sql);

// DDL only, comment lines (`-- …`) stripped, so prose in the header that merely
// names organization_id / RLS does not register as actual schema.
const ddl = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// The live registries (api half + rss half) → the source-of-truth id↔kind map.
const expected = new Map<string, string>();
for (const s of API_SOURCES) expected.set(s.id, "api");
for (const f of FEEDS) expected.set(f.id, f.kind ?? "rss");

describe("sources migration — registry parity (B1)", () => {
  it("seeds exactly the 13 known sources (7 api + 6 rss)", () => {
    expect(seeded).toHaveLength(13);
    expect(seeded.filter((r) => r.kind === "api")).toHaveLength(7);
    expect(seeded.filter((r) => r.kind === "rss")).toHaveLength(6);
  });

  it("has no duplicate seeded source ids", () => {
    const ids = seeded.map((r) => r.source);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("seed set equals the live registry id set exactly (no extras, no missing)", () => {
    const seededIds = seeded.map((r) => r.source).sort();
    const registryIds = [...expected.keys()].sort();
    expect(seededIds).toEqual(registryIds);
  });

  it("tags every seeded source with the same kind the registry declares", () => {
    for (const row of seeded) {
      expect(row.kind).toBe(expected.get(row.source));
    }
  });

  it("declares the table GLOBAL — no organization_id, no RLS", () => {
    expect(ddl).not.toMatch(/organization_id/i);
    expect(ddl).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(ddl).not.toMatch(/CREATE POLICY/i);
  });

  it("is reversible and idempotent (documented DROP + guarded writes)", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sources/);
    expect(sql).toMatch(/ON CONFLICT \(source\) DO NOTHING/);
    expect(sql).toMatch(/DROP TABLE sources/); // reversal documented in header
  });
});
