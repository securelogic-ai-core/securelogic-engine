/**
 * enterpriseContextImport.test.ts — ECL Slice 3: unit tests for the pure
 * import-planning core (DB-free). Covers all five entity types, malformed rows,
 * in-file + in-DB dedup, cap-exceeded, status precedence, and determinism.
 */

import { describe, expect, it } from "vitest";
import {
  planImport,
  isImportEntityType,
  IMPORT_ENTITY_TYPES,
  type ImportRow
} from "../lib/enterpriseContextImport.js";

const NO_EXISTING = new Set<string>();
const BIG_CAP = 1_000_000;

function rows(...rs: ImportRow[]): ImportRow[] { return rs; }

describe("isImportEntityType", () => {
  it("accepts the five onboarding types, rejects others", () => {
    for (const t of IMPORT_ENTITY_TYPES) expect(isImportEntityType(t)).toBe(true);
    expect(isImportEntityType("business_unit")).toBe(false); // valid entity_type but not importable in S3
    expect(isImportEntityType("nope")).toBe(false);
  });
});

describe("planImport — valid rows per entity type", () => {
  it("asset / application → enterprise_entity normalized", () => {
    const p = planImport({ entityType: "asset", rows: rows({ name: "web-01", criticality: "high" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.summary).toMatchObject({ total: 1, ok: 1, invalid: 0, duplicate: 0, cap_exceeded: 0 });
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[0].normalized).toMatchObject({ kind: "enterprise_entity", input: { entity_type: "asset", name: "web-01", criticality: "high" } });
  });

  it("data_store → nested typed child validated", () => {
    const p = planImport({ entityType: "data_store", rows: rows({ name: "pg-main", data_classification: "restricted", encryption_at_rest: "yes" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[0].normalized).toMatchObject({ kind: "enterprise_entity", input: { entity_type: "data_store", data_store: { data_classification: "restricted", encryption_at_rest: true } } });
  });

  it("vendor → vendor normalized", () => {
    const p = planImport({ entityType: "vendor", rows: rows({ name: "Acme SaaS", website: "https://acme.example" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[0].normalized).toMatchObject({ kind: "vendor", input: { name: "Acme SaaS" } });
  });

  it("ai_system → ai_system normalized", () => {
    const p = planImport({ entityType: "ai_system", rows: rows({ name: "Support Copilot", use_case: "ticket triage" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[0].normalized).toMatchObject({ kind: "ai_system", input: { name: "Support Copilot" } });
  });
});

describe("planImport — malformed rows", () => {
  it("missing name → invalid (reuses the manual-create validator)", () => {
    for (const t of IMPORT_ENTITY_TYPES) {
      const p = planImport({ entityType: t, rows: rows({ name: "  " }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
      expect(p.rows[0].status).toBe("invalid");
      expect(p.rows[0].error).toMatch(/name/);
    }
  });

  it("invalid enum → invalid (data_store classification)", () => {
    const p = planImport({ entityType: "data_store", rows: rows({ name: "db", data_classification: "top-secret" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("invalid");
    expect(p.rows[0].error).toBe("data_classification_invalid");
  });

  it("invalid criticality → invalid (enterprise entity)", () => {
    const p = planImport({ entityType: "asset", rows: rows({ name: "x", criticality: "CRITICAL" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("invalid");
  });
});

describe("planImport — dedup", () => {
  it("in-file duplicate: first ok, second duplicate_in_file (case-insensitive)", () => {
    const p = planImport({ entityType: "asset", rows: rows({ name: "Server-A" }, { name: "server-a" }), existingKeys: NO_EXISTING, capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("ok");
    expect(p.rows[1].status).toBe("duplicate_in_file");
    expect(p.summary).toMatchObject({ ok: 1, duplicate: 1 });
  });

  it("in-db duplicate: existing key → duplicate_in_db", () => {
    const p = planImport({ entityType: "vendor", rows: rows({ name: "Acme" }), existingKeys: new Set(["acme"]), capHeadroom: BIG_CAP });
    expect(p.rows[0].status).toBe("duplicate_in_db");
    expect(p.summary).toMatchObject({ ok: 0, duplicate: 1 });
  });
});

describe("planImport — capacity", () => {
  it("cap_exceeded after headroom is used, only for otherwise-ok rows", () => {
    const p = planImport({ entityType: "asset", rows: rows({ name: "a" }, { name: "b" }, { name: "c" }), existingKeys: NO_EXISTING, capHeadroom: 2 });
    expect(p.rows.map((r) => r.status)).toEqual(["ok", "ok", "cap_exceeded"]);
    expect(p.summary).toMatchObject({ ok: 2, cap_exceeded: 1 });
  });

  it("zero headroom → every valid row cap_exceeded; invalid/dup still take precedence", () => {
    const p = planImport({ entityType: "asset", rows: rows({ name: "" }, { name: "dup" }, { name: "dup" }, { name: "new" }), existingKeys: NO_EXISTING, capHeadroom: 0 });
    // row1 invalid; row2 valid+first-seen but zero headroom → cap_exceeded (never marked ok, so row3 sees it as unseen → also cap_exceeded); row4 cap_exceeded
    expect(p.rows[0].status).toBe("invalid");
    expect(p.rows[1].status).toBe("cap_exceeded");
    expect(p.rows[3].status).toBe("cap_exceeded");
    expect(p.summary.ok).toBe(0);
  });

  it("dedup precedence over cap: a duplicate does NOT consume headroom", () => {
    const p = planImport({ entityType: "asset", rows: rows({ name: "a" }, { name: "a" }, { name: "b" }), existingKeys: NO_EXISTING, capHeadroom: 2 });
    expect(p.rows.map((r) => r.status)).toEqual(["ok", "duplicate_in_file", "ok"]);
    expect(p.summary).toMatchObject({ ok: 2, duplicate: 1, cap_exceeded: 0 });
  });
});

describe("planImport — determinism", () => {
  it("identical inputs yield an identical plan", () => {
    const input = { entityType: "vendor" as const, rows: rows({ name: "A" }, { name: "B" }, { name: "A" }), existingKeys: new Set(["b"]), capHeadroom: 5 };
    expect(JSON.stringify(planImport(input))).toEqual(JSON.stringify(planImport(input)));
  });
});
