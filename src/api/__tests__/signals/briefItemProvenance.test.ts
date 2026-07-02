/**
 * briefItemProvenance.test.ts — Priority 4 / Phase 4D / D1.
 *
 * D1 adds the additive, INERT provenance edge table
 * (intelligence_brief_item_provenance). No DB: this parses the migration text +
 * the classification map. Pins the schema shape, the tenant-isolation RLS, the
 * integrity constraints, idempotency/reversibility, and that NO existing table
 * (esp. the dedup path) is modified.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TABLE_CLASSIFICATION } from "../../lib/dataClassification.js";

const SQL = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../db/migrations/20260710_brief_item_signal_provenance.sql"
  ),
  "utf8"
);
const ddl = SQL.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("brief_item_provenance migration — schema (D1)", () => {
  it("creates the table idempotently", () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS intelligence_brief_item_provenance/i);
  });

  it("is org-owned: organization_id NOT NULL, CASCADE from organizations", () => {
    expect(ddl).toMatch(/organization_id\s+UUID\s+NOT NULL\s+REFERENCES organizations\(id\)\s+ON DELETE CASCADE/i);
  });

  it("links brief_item (CASCADE) and cyber_signal (SET NULL, lineage survives purge)", () => {
    expect(ddl).toMatch(/brief_item_id\s+UUID\s+NOT NULL\s+REFERENCES intelligence_brief_items\(id\)\s+ON DELETE CASCADE/i);
    expect(ddl).toMatch(/cyber_signal_id\s+UUID\s+REFERENCES cyber_signals\(id\)\s+ON DELETE SET NULL/i);
    expect(ddl).toMatch(/source_slug\s+TEXT/i); // denormalised, survives signal deletion
  });

  it("constrains relation and enforces one edge per (brief_item, signal)", () => {
    expect(ddl).toMatch(/relation IN \('canonical', 'corroborating'\)/i);
    expect(ddl).toMatch(/UNIQUE \(brief_item_id, cyber_signal_id\)/i);
  });
});

describe("brief_item_provenance migration — tenant isolation (D1)", () => {
  it("enables RLS and a NULLIF-guarded org policy (USING + WITH CHECK)", () => {
    expect(ddl).toMatch(/ALTER TABLE intelligence_brief_item_provenance ENABLE ROW LEVEL SECURITY/i);
    expect(ddl).toMatch(/CREATE POLICY brief_item_provenance_tenant_isolation/i);
    expect(ddl).toMatch(/USING\s*\(organization_id = NULLIF\(current_setting\('app\.current_org_id', true\), ''\)::uuid\)/i);
    expect(ddl).toMatch(/WITH CHECK\s*\(organization_id = NULLIF\(current_setting\('app\.current_org_id', true\), ''\)::uuid\)/i);
  });

  it("does NOT FORCE RLS (owner bypass — inert until the app_request flip)", () => {
    expect(ddl).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });
});

describe("brief_item_provenance migration — isolation + reversibility (D1)", () => {
  it("modifies NO existing table and never touches the dedup path", () => {
    expect(ddl).not.toMatch(/ALTER TABLE cyber_signals/i);
    expect(ddl).not.toMatch(/ALTER TABLE intelligence_brief_items/i);
    expect(ddl).not.toMatch(/dedup_hash|buildDedupHash|idx_cyber_signals_dedup|ON CONFLICT/i);
  });

  it("documents a clean reversal (DROP TABLE)", () => {
    expect(SQL).toMatch(/DROP TABLE intelligence_brief_item_provenance/i);
  });
});

describe("brief_item_provenance — classification (D1)", () => {
  it("is classified as org-scoped with RLS enabled", () => {
    const c = TABLE_CLASSIFICATION["intelligence_brief_item_provenance"];
    expect(c).toBeDefined();
    expect(c!.category).toBe("E");
    expect(c!.rlsStatus).toBe("enabled");
    expect(c!.piiRisk).toBe("none");
  });
});
