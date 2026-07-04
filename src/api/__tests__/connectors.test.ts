/**
 * connectors.test.ts — Slice 8: connector framework + ServiceNow CMDB reference
 * adapter. Mock-backed (fake HttpClient); no network, no DB.
 */

import { describe, expect, it } from "vitest";

import { serviceNowCmdbAdapter } from "../lib/connectors/serviceNowCmdb.js";
import { listConnectors, getConnector, REQUIRED_CONNECTOR_IDS } from "../lib/connectors/registry.js";
import type { HttpClient } from "../lib/connectors/types.js";
import { isImportEntityType } from "../lib/enterpriseContextImport.js";

const CMDB_PAYLOAD = {
  result: [
    { sys_id: "ci-app-1", name: "Billing App", sys_class_name: "cmdb_ci_business_app", short_description: "Invoicing", business_criticality: "1 - most critical", depends_on: ["ci-db-1"] },
    { sys_id: "ci-db-1", name: "Billing DB", sys_class_name: "cmdb_ci_database", business_criticality: "2 - somewhat critical" },
    { sys_id: "ci-srv-1", name: "Web Server 01", sys_class_name: "cmdb_ci_server" },
    { sys_id: "ci-app-1", name: "Billing App DUPLICATE", sys_class_name: "cmdb_ci_business_app" }, // dup sys_id ignored
    { name: "no sys_id — skipped", sys_class_name: "cmdb_ci_server" }
  ]
};

describe("ServiceNow CMDB — normalize (pure)", () => {
  it("maps CIs to ECL entity types and extracts dependency edges", () => {
    const inv = serviceNowCmdbAdapter.normalize(CMDB_PAYLOAD);
    const byRef = Object.fromEntries(inv.entities.map((e) => [e.external_ref, e]));

    expect(inv.entities).toHaveLength(3); // dup + missing-sys_id dropped
    expect(byRef["ci-app-1"].entity_type).toBe("application");
    expect(byRef["ci-db-1"].entity_type).toBe("data_store");
    expect(byRef["ci-srv-1"].entity_type).toBe("asset");
    expect(byRef["ci-app-1"].criticality).toBe("critical");
    expect(byRef["ci-db-1"].criticality).toBe("high");

    expect(inv.relationships).toEqual([
      { from_external_ref: "ci-app-1", to_external_ref: "ci-db-1", relationship_type: "depends_on" }
    ]);
  });

  it("every normalized entity_type is a valid ECL import type", () => {
    for (const e of serviceNowCmdbAdapter.normalize(CMDB_PAYLOAD).entities) {
      expect(isImportEntityType(e.entity_type)).toBe(true);
    }
  });

  it("is deterministic and tolerates malformed input", () => {
    expect(serviceNowCmdbAdapter.normalize(CMDB_PAYLOAD)).toEqual(serviceNowCmdbAdapter.normalize(CMDB_PAYLOAD));
    expect(serviceNowCmdbAdapter.normalize(null)).toEqual({ entities: [], relationships: [] });
    expect(serviceNowCmdbAdapter.normalize({ result: "nope" })).toEqual({ entities: [], relationships: [] });
  });

  it("fetch calls the CMDB table API with Basic auth via the injected client", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const http: HttpClient = {
      async getJson(url, headers) {
        calls.push({ url, headers });
        return CMDB_PAYLOAD;
      }
    };
    const cfg = { instance_url: "https://acme.service-now.com/", username: "svc", password: "pw" };
    const raw = await serviceNowCmdbAdapter.fetch(cfg, http);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://acme.service-now.com/api/now/table/cmdb_ci?sysparm_limit=1000");
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("svc:pw").toString("base64")}`);
    // round-trips into normalize
    expect(serviceNowCmdbAdapter.normalize(raw).entities.length).toBe(3);
  });
});

describe("ServiceNow CMDB — config validation", () => {
  it("accepts a complete https config", () => {
    const r = serviceNowCmdbAdapter.validateConfig({ instance_url: "https://acme.service-now.com", username: "u", password: "p" });
    expect("config" in r).toBe(true);
  });
  it("rejects a missing required field", () => {
    const r = serviceNowCmdbAdapter.validateConfig({ instance_url: "https://acme.service-now.com", username: "u" });
    expect(r).toMatchObject({ error: "config_field_missing" });
  });
  it("rejects a non-https instance_url", () => {
    const r = serviceNowCmdbAdapter.validateConfig({ instance_url: "http://acme.service-now.com", username: "u", password: "p" });
    expect(r).toMatchObject({ error: "config_field_url" });
  });
});

describe("connector registry", () => {
  it("registers every roadmap-required connector", () => {
    const ids = listConnectors().map((c) => c.id).sort();
    expect(ids).toEqual([...REQUIRED_CONNECTOR_IDS].sort());
  });

  it("ServiceNow is the reference adapter; the rest are planned", () => {
    expect(getConnector("servicenow_cmdb")!.status).toBe("reference");
    for (const id of REQUIRED_CONNECTOR_IDS) {
      if (id === "servicenow_cmdb") continue;
      expect(getConnector(id)!.status).toBe("planned");
    }
  });

  it("every connector exposes a non-empty config schema", () => {
    for (const c of listConnectors()) expect(c.configFields.length).toBeGreaterThan(0);
  });

  it("planned adapters validate config but throw connector_not_implemented on normalize/fetch", () => {
    const defender = getConnector("microsoft_defender")!;
    expect("config" in defender.validateConfig({ tenant_id: "t", client_id: "c", client_secret: "s" })).toBe(true);
    expect(() => defender.normalize({})).toThrow(/connector_not_implemented/);
  });
});
