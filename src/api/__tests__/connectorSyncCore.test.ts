/**
 * connectorSyncCore.test.ts — EAR Phase 3b: the pure connector→registry
 * mapping plane (category → detail asset vs import lane), plus lockstep
 * asserts binding the 20260807/20260808 migrations to the code truth
 * (REQUIRED_CONNECTOR_IDS, CONNECTOR_SYNC_JOB_TYPE).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import {
  planConnectorSync,
  idpSystemDetail,
  MAX_ENTITIES_PER_SYNC,
  CONNECTOR_SYNC_JOB_TYPE
} from "../lib/connectorSyncCore.js";
import { REQUIRED_CONNECTOR_IDS } from "../lib/connectors/registry.js";
import type { NormalizedEntity, NormalizedInventory } from "../lib/connectors/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONNECTORS_MIGRATION = path.resolve(HERE, "../../../db/migrations/20260807_enterprise_connectors.sql");
const JOBS_MIGRATION = path.resolve(HERE, "../../../db/migrations/20260808_jobs_connector_sync.sql");

function inv(entities: NormalizedEntity[], relationships = 0): NormalizedInventory {
  return {
    entities,
    relationships: Array.from({ length: relationships }, (_, i) => ({
      from_external_ref: `a${i}`,
      to_external_ref: `b${i}`,
      relationship_type: "depends_on" as const
    }))
  };
}

const DEFENDER = { id: "microsoft_defender", displayName: "Microsoft Defender", category: "endpoint" as const };
const TENABLE = { id: "tenable", displayName: "Tenable", category: "vulnerability" as const };
const WIZ = { id: "wiz", displayName: "Wiz", category: "cloud" as const };
const CLOUD = { id: "cloud_inventory", displayName: "Cloud Inventory", category: "cloud" as const };
const CMDB = { id: "servicenow_cmdb", displayName: "ServiceNow CMDB", category: "cmdb" as const };
const IDP = { id: "identity_provider", displayName: "Identity Provider (Okta/Entra)", category: "identity" as const };

describe("planConnectorSync — category mapping", () => {
  it("endpoint + vulnerability categories: 'asset' rows become endpoint detail assets", () => {
    for (const adapter of [DEFENDER, TENABLE]) {
      const plan = planConnectorSync(
        adapter,
        inv([{ entity_type: "asset", name: "laptop-1", external_ref: "m-1", criticality: "high" }]),
        {}
      );
      expect(plan.detailInputs).toEqual([
        expect.objectContaining({
          asset_type: "endpoint",
          name: "laptop-1",
          criticality: "high",
          external_ref: "m-1",
          typed: { hostname: "laptop-1" }
        })
      ]);
      expect(plan.importGroups).toEqual({});
    }
  });

  it("cloud category: 'asset' → cloud_resource detail (provider from config); app/data_store → import lane", () => {
    const plan = planConnectorSync(
      WIZ,
      inv([
        { entity_type: "asset", name: "vm-1", external_ref: "w-1" },
        { entity_type: "application", name: "checkout", external_ref: "w-2" },
        {
          entity_type: "data_store",
          name: "orders-db",
          external_ref: "w-3",
          data_store: { residency_region: "eu-west-1" }
        }
      ]),
      {}
    );
    expect(plan.detailInputs).toEqual([
      expect.objectContaining({ asset_type: "cloud_resource", name: "vm-1", typed: { provider: "other" } })
    ]);
    expect(plan.importGroups.application).toEqual([expect.objectContaining({ name: "checkout", external_ref: "w-2" })]);
    expect(plan.importGroups.data_store).toEqual([
      expect.objectContaining({ name: "orders-db", residency_region: "eu-west-1" })
    ]);

    const aws = planConnectorSync(
      CLOUD,
      inv([{ entity_type: "asset", name: "i-0abc", external_ref: "c-1" }]),
      { provider: "AWS" }
    );
    expect(aws.detailInputs[0]!.typed).toEqual({ provider: "aws" });
  });

  it("cmdb category: everything flows through the import lane (CSV parity)", () => {
    const plan = planConnectorSync(
      CMDB,
      inv([
        { entity_type: "asset", name: "srv-1", external_ref: "s-1" },
        { entity_type: "application", name: "erp", external_ref: "s-2" }
      ]),
      {}
    );
    expect(plan.detailInputs).toEqual([]);
    expect(plan.importGroups.asset).toHaveLength(1);
    expect(plan.importGroups.application).toHaveLength(1);
  });

  it("identity category: accounts → import lane; the IdP itself becomes one identity_system detail asset", () => {
    const plan = planConnectorSync(
      IDP,
      inv([{ entity_type: "identity", name: "Jane Doe", external_ref: "u-1" }]),
      { base_url: "https://corp.okta.com" }
    );
    expect(plan.importGroups.identity).toEqual([expect.objectContaining({ name: "Jane Doe", external_ref: "u-1" })]);
    expect(plan.detailInputs).toEqual([
      expect.objectContaining({
        asset_type: "identity_system",
        name: "corp.okta.com",
        external_ref: "identity_provider:corp.okta.com"
      })
    ]);
  });

  it("idpSystemDetail is null without a parseable base_url", () => {
    expect(idpSystemDetail(IDP, {})).toBeNull();
    expect(idpSystemDetail(IDP, { base_url: "not a url" })).toBeNull();
  });

  it("truncates past MAX_ENTITIES_PER_SYNC and counts relationships as skipped, never silently", () => {
    const entities: NormalizedEntity[] = Array.from({ length: MAX_ENTITIES_PER_SYNC + 7 }, (_, i) => ({
      entity_type: "asset" as const,
      name: `host-${i}`,
      external_ref: `m-${i}`
    }));
    const plan = planConnectorSync(DEFENDER, inv(entities, 3), {});
    expect(plan.truncated).toBe(7);
    expect(plan.detailInputs).toHaveLength(MAX_ENTITIES_PER_SYNC);
    expect(plan.relationshipsSkipped).toBe(3);
  });
});

describe("migration lockstep", () => {
  it("20260807 connector_id CHECK admits exactly REQUIRED_CONNECTOR_IDS", () => {
    const sql = readFileSync(CONNECTORS_MIGRATION, "utf8");
    for (const id of REQUIRED_CONNECTOR_IDS) {
      expect(sql, id).toContain(`'${id}'`);
    }
    const checkIds = [...sql.matchAll(/'([a-z0-9_]+)'/g)]
      .map((m) => m[1]!)
      .filter((v) => (REQUIRED_CONNECTOR_IDS as readonly string[]).includes(v));
    expect(new Set(checkIds).size).toBe(REQUIRED_CONNECTOR_IDS.length);
  });

  it("20260808 widens the jobs CHECK with connector_sync and keeps every prior value", () => {
    const sql = readFileSync(JOBS_MIGRATION, "utf8");
    expect(sql).toContain(`'${CONNECTOR_SYNC_JOB_TYPE}'`);
    for (const prior of [
      "data_export_self",
      "data_export_org",
      "account_deletion_reap",
      "export_file_purge",
      "vendor_assurance_extract",
      "applicability_reassess"
    ]) {
      expect(sql, prior).toContain(`'${prior}'`);
    }
  });
});
