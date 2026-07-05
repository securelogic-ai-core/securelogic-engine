/**
 * assetRegistry.test.ts — EAR Phase 0: the canonical asset contract, the
 * feature-flag predicate, and the code↔migration lockstep assertions.
 * Real-Postgres view behavior is covered by test/isolation/assetRegistryView.test.ts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import {
  ASSET_TYPES,
  ASSET_TYPE_SPECS,
  ENTITY_TYPE_TO_ASSET_TYPE,
  entityTypeToAssetType,
  isAssetType
} from "../lib/assetRegistry.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../db/migrations/20260802_asset_registry_view.sql"
);

describe("assetRegistryEnabled", () => {
  it("is OFF by default and only on for the exact string 'true'", () => {
    expect(assetRegistryEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(assetRegistryEnabled({ SECURELOGIC_ASSET_REGISTRY_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(assetRegistryEnabled({ SECURELOGIC_ASSET_REGISTRY_ENABLED: "TRUE" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(assetRegistryEnabled({ SECURELOGIC_ASSET_REGISTRY_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("asset type contract", () => {
  it("every asset type has a spec, keyed consistently", () => {
    for (const t of ASSET_TYPES) {
      const spec = ASSET_TYPE_SPECS[t];
      expect(spec, `${t} must have a spec`).toBeDefined();
      expect(spec.type).toBe(t);
    }
    expect(Object.keys(ASSET_TYPE_SPECS).sort()).toEqual([...ASSET_TYPES].sort());
  });

  it("Phase-2 truth: graph-representability covers every ECL-graph-backed type; risk targets are the matched four", () => {
    // graphRepresentable: vendors/ai_systems + every enterprise_entities-backed
    // type (their rows ARE graph nodes); Phase-3 detail-table types stay false
    // until their tables exist.
    const graphable = new Set(["vendor", "ai_system", "application", "database", "business_process", "generic"]);
    // Risk targets (matched by name): the two live branches + the two
    // enterprise_entities-backed types the generic asset matcher covers
    // behind SECURELOGIC_ASSET_REGISTRY_ENABLED.
    const riskTargets = new Set(["vendor", "ai_system", "application", "database"]);
    for (const t of ASSET_TYPES) {
      const spec = ASSET_TYPE_SPECS[t];
      expect(spec.graphRepresentable, t).toBe(graphable.has(t));
      expect(spec.isRiskTarget, t).toBe(riskTargets.has(t));
      expect(spec.matchStrategy, t).toBe(riskTargets.has(t) ? "name_canonical" : "none");
    }
  });

  it("isGraphRepresentableTarget bridges match-target vocabulary to the spec", async () => {
    const { isGraphRepresentableTarget } = await import("../lib/assetRegistry.js");
    expect(isGraphRepresentableTarget("vendor")).toBe(true);
    expect(isGraphRepresentableTarget("ai_system")).toBe(true);
    expect(isGraphRepresentableTarget("control")).toBe(false);
    expect(isGraphRepresentableTarget("obligation")).toBe(false);
    expect(isGraphRepresentableTarget("asset", "application")).toBe(true);
    expect(isGraphRepresentableTarget("asset", "cloud_resource")).toBe(false);
    expect(isGraphRepresentableTarget("asset", null)).toBe(false); // fail-closed
    expect(isGraphRepresentableTarget("asset", "bogus")).toBe(false);
  });

  it("isAssetType accepts the vocabulary and rejects everything else", () => {
    expect(isAssetType("vendor")).toBe(true);
    expect(isAssetType("database")).toBe(true);
    expect(isAssetType("data_store")).toBe(false); // entity_type, not asset_type
    expect(isAssetType("")).toBe(false);
    expect(isAssetType(42)).toBe(false);
    expect(isAssetType(undefined)).toBe(false);
  });

  it("entity_type projection: application→application, data_store→database, rest→generic", () => {
    expect(entityTypeToAssetType("application")).toBe("application");
    expect(entityTypeToAssetType("data_store")).toBe("database");
    for (const et of ["asset", "business_service", "business_unit", "department", "data_classification", "identity"]) {
      expect(entityTypeToAssetType(et), et).toBe("generic");
    }
  });
});

describe("code ↔ 20260802 migration lockstep", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("the view CASE mirrors ENTITY_TYPE_TO_ASSET_TYPE", () => {
    for (const [entityType, assetType] of Object.entries(ENTITY_TYPE_TO_ASSET_TYPE)) {
      expect(sql).toMatch(new RegExp(`WHEN '${entityType}'\\s+THEN '${assetType}'`));
    }
    expect(sql).toContain("ELSE 'generic'");
  });

  it("defense-in-depth is declared: version-guarded security_invoker + read-only app_request grants", () => {
    expect(sql).toContain("server_version_num");
    expect(sql).toContain("security_invoker = true");
    expect(sql).toContain("GRANT SELECT ON asset_registry_v TO app_request");
    expect(sql).toContain("GRANT SELECT ON vendors          TO app_request");
    expect(sql).toContain("GRANT SELECT ON ai_systems       TO app_request");
    // Read-only surface: the migration must not open any write path
    // (comments stripped — the header itself mentions the words).
    const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)/i);
  });

  it("projects the three backing kinds and the canonical columns", () => {
    for (const kind of ["'vendors'::text", "'ai_systems'::text", "'enterprise_entities'::text"]) {
      expect(sql).toContain(kind);
    }
    for (const col of ["asset_id", "asset_type", "organization_id", "backing_kind", "backing_id", "lifecycle_status"]) {
      expect(sql).toContain(col);
    }
  });
});
