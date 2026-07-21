/**
 * assetDetailValidation.test.ts — EAR Phase 3a: create-input validation for
 * the four detail-backed asset types + vocabulary lockstep with the 20260806
 * migration CHECKs.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import {
  validateAssetDetailCreate,
  DETAIL_BACKED_TYPES,
  DETAIL_TABLE_SPEC,
  isDetailBackedType
} from "../lib/assetDetailValidation.js";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../db/migrations/20260806_asset_detail_tables.sql"
);

describe("validateAssetDetailCreate", () => {
  it("accepts a minimal valid create per type", () => {
    for (const t of DETAIL_BACKED_TYPES) {
      const body: Record<string, unknown> = { asset_type: t, name: `My ${t}` };
      if (t === "cloud_resource") body.provider = "aws";
      const r = validateAssetDetailCreate(body);
      expect("input" in r, t).toBe(true);
      if ("input" in r) {
        expect(r.input.status).toBe("active");
        expect(r.input.criticality).toBeNull();
      }
    }
  });

  it("rejects non-detail-backed and unknown types with routing guidance", () => {
    for (const t of ["vendor", "ai_system", "application", "database", "business_process", "generic", "spaceship"]) {
      const r = validateAssetDetailCreate({ asset_type: t, name: "x" });
      expect(r).toMatchObject({ error: "asset_type_invalid" });
    }
    expect(isDetailBackedType("endpoint")).toBe(true);
    expect(isDetailBackedType("vendor")).toBe(false);
  });

  it("enforces required/closed vocabularies", () => {
    expect(validateAssetDetailCreate({ asset_type: "cloud_resource", name: "vm" }))
      .toMatchObject({ error: "provider_required" });
    expect(validateAssetDetailCreate({ asset_type: "cloud_resource", name: "vm", provider: "ibm" }))
      .toMatchObject({ error: "provider_invalid" });
    expect(validateAssetDetailCreate({ asset_type: "endpoint", name: "l1", exposure: "public" }))
      .toMatchObject({ error: "exposure_invalid" });
    expect(validateAssetDetailCreate({ asset_type: "api", name: "a1", protocol: "carrier_pigeon" }))
      .toMatchObject({ error: "protocol_invalid" });
    expect(validateAssetDetailCreate({ asset_type: "identity_system", name: "i1", protocol: "saml" }))
      .toHaveProperty("input");
    expect(validateAssetDetailCreate({ asset_type: "endpoint", name: "" }))
      .toMatchObject({ error: "name_required" });
    expect(validateAssetDetailCreate({ asset_type: "endpoint", name: "x".repeat(201) }))
      .toMatchObject({ error: "name_too_long" });
    expect(validateAssetDetailCreate({ asset_type: "endpoint", name: "l1", criticality: "urgent" }))
      .toMatchObject({ error: "criticality_invalid" });
    expect(validateAssetDetailCreate({ asset_type: "endpoint", name: "l1", status: "paused" }))
      .toMatchObject({ error: "status_invalid" });
  });
});

describe("validator ↔ 20260806 migration lockstep", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("every closed vocabulary matches its table CHECK", () => {
    // provider
    expect(sql).toMatch(/provider IN \('aws', 'azure', 'gcp', 'other'\)/);
    // endpoint exposure
    expect(sql).toMatch(/exposure IN \('internal', 'internet_facing', 'isolated'\)/);
    // api protocol / auth / exposure
    expect(sql).toMatch(/protocol IN \('rest', 'graphql', 'grpc', 'soap', 'other'\)/);
    expect(sql).toMatch(/auth_method IN \('none', 'api_key', 'oauth2', 'mtls', 'basic', 'other'\)/);
    expect(sql).toMatch(/exposure IN \('internal', 'internet_facing', 'partner'\)/);
    // identity protocol
    expect(sql).toMatch(/protocol IN \('saml', 'oidc', 'ldap', 'radius', 'proprietary', 'other'\)/);
  });

  it("every detail table + typed column in DETAIL_TABLE_SPEC exists in the migration", () => {
    for (const spec of Object.values(DETAIL_TABLE_SPEC)) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${spec.table}`);
      for (const col of spec.typedColumns) {
        expect(sql, `${spec.table}.${col}`).toMatch(new RegExp(`${col}\\s`));
      }
      // RLS + grants per table.
      expect(sql).toContain(`ALTER TABLE ${spec.table.padEnd(0)}`.trim());
      expect(sql).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${spec.table}\\s+TO app_request`));
    }
    // registry admits the new backing kinds
    for (const spec of Object.values(DETAIL_TABLE_SPEC)) {
      expect(sql).toContain(`'${spec.table}'`);
    }
  });
});
