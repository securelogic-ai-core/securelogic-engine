/**
 * connectorAdapters.test.ts — R7: mock-backed tests for the seven newly
 * implemented connector adapters (Defender, Falcon, Wiz, Tenable, Qualys,
 * Rapid7, cloud inventory, identity provider). For each: pure `normalize()`
 * mapping (entity types, criticality vocabulary, dedup, determinism, malformed
 * tolerance) and `fetch()` against a fake HttpClient (auth headers, OAuth
 * token legs, endpoint shapes, typed errors). No network, no DB — the
 * ServiceNow reference-test convention.
 */

import { describe, expect, it } from "vitest";

import type { HttpClient, NormalizedInventory } from "../lib/connectors/types.js";
import { microsoftDefenderAdapter } from "../lib/connectors/microsoftDefender.js";
import { crowdstrikeFalconAdapter } from "../lib/connectors/crowdstrikeFalcon.js";
import { wizAdapter } from "../lib/connectors/wiz.js";
import { tenableAdapter } from "../lib/connectors/tenable.js";
import { qualysAdapter } from "../lib/connectors/qualys.js";
import { rapid7Adapter } from "../lib/connectors/rapid7.js";
import { cloudInventoryAdapter } from "../lib/connectors/cloudInventory.js";
import { identityProviderAdapter } from "../lib/connectors/identityProvider.js";
import { IMPORT_ENTITY_TYPES } from "../lib/enterpriseContextImport.js";

/** Recording fake with all three HTTP legs. */
function fakeHttp(responses: { get?: unknown; postForm?: unknown; postJson?: unknown }) {
  const calls: Array<{ kind: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  const http: HttpClient = {
    async getJson(url, headers) {
      calls.push({ kind: "get", url, headers });
      return responses.get;
    },
    async postForm(url, headers, form) {
      calls.push({ kind: "postForm", url, headers, body: form });
      return responses.postForm;
    },
    async postJson(url, headers, body) {
      calls.push({ kind: "postJson", url, headers, body });
      return responses.postJson;
    }
  };
  return { http, calls };
}

function assertImportableAndSorted(inv: NormalizedInventory): void {
  for (const e of inv.entities) {
    expect(IMPORT_ENTITY_TYPES).toContain(e.entity_type);
    expect(e.name.length).toBeGreaterThan(0);
    expect(e.external_ref.length).toBeGreaterThan(0);
  }
  const refs = inv.entities.map((e) => e.external_ref);
  expect(refs).toEqual([...refs].sort());
}

// ─── Microsoft Defender ────────────────────────────────────────────────────────

describe("microsoft_defender", () => {
  const machines = {
    value: [
      { id: "m2", computerDnsName: "web01.corp", osPlatform: "Windows11", exposureLevel: "High" },
      { id: "m1", computerDnsName: "db01.corp", osPlatform: "WindowsServer2022", exposureLevel: "Medium" },
      { id: "m2", computerDnsName: "dup.corp" }, // duplicate id → dropped
      { id: "m3" } // no name → dropped
    ]
  };

  it("normalizes machines to assets with exposure-mapped criticality, deduped + sorted", () => {
    const inv = microsoftDefenderAdapter.normalize(machines);
    expect(inv.entities).toHaveLength(2);
    expect(inv.entities[0]).toMatchObject({ entity_type: "asset", external_ref: "m1", criticality: "medium" });
    expect(inv.entities[1]).toMatchObject({ entity_type: "asset", external_ref: "m2", criticality: "high", name: "web01.corp" });
    expect(inv.relationships).toHaveLength(0);
    assertImportableAndSorted(inv);
    expect(microsoftDefenderAdapter.normalize(null)).toEqual({ entities: [], relationships: [] });
  });

  it("fetch does the OAuth client-credentials leg, then Bearer-GETs machines", async () => {
    const { http, calls } = fakeHttp({ postForm: { access_token: "tok-1" }, get: machines });
    await microsoftDefenderAdapter.fetch({ tenant_id: "tnt", client_id: "cid", client_secret: "sec" }, http);
    expect(calls[0]).toMatchObject({
      kind: "postForm",
      url: "https://login.microsoftonline.com/tnt/oauth2/v2.0/token",
      body: { grant_type: "client_credentials", client_id: "cid", client_secret: "sec" }
    });
    expect(calls[1]).toMatchObject({ kind: "get", url: "https://api.securitycenter.microsoft.com/api/machines" });
    expect(calls[1].headers.Authorization).toBe("Bearer tok-1");
  });

  it("fetch fails loudly on a missing token or a client without postForm", async () => {
    const { http } = fakeHttp({ postForm: {} });
    await expect(
      microsoftDefenderAdapter.fetch({ tenant_id: "t", client_id: "c", client_secret: "s" }, http)
    ).rejects.toThrow(/no access_token/);
    const getOnly: HttpClient = { getJson: async () => ({}) };
    await expect(
      microsoftDefenderAdapter.fetch({ tenant_id: "t", client_id: "c", client_secret: "s" }, getOnly)
    ).rejects.toThrow(/connector_http_client_missing_post_form/);
  });
});

// ─── CrowdStrike Falcon ────────────────────────────────────────────────────────

describe("crowdstrike_falcon", () => {
  it("normalizes device resources to assets, deduped + sorted; tolerates malformed", () => {
    const inv = crowdstrikeFalconAdapter.normalize({
      resources: [
        { device_id: "d2", hostname: "edge02", platform_name: "Linux" },
        { device_id: "d1", hostname: "edge01", os_version: "RHEL 9" },
        { device_id: "d1", hostname: "dup" },
        { hostname: "no-id" }
      ]
    });
    expect(inv.entities.map((e) => e.external_ref)).toEqual(["d1", "d2"]);
    assertImportableAndSorted(inv);
    expect(crowdstrikeFalconAdapter.normalize("garbage")).toEqual({ entities: [], relationships: [] });
  });

  it("fetch exchanges client credentials at the base URL, then Bearer-GETs devices", async () => {
    const { http, calls } = fakeHttp({ postForm: { access_token: "fal-tok" }, get: { resources: [] } });
    await crowdstrikeFalconAdapter.fetch(
      { base_url: "https://api.crowdstrike.com/", client_id: "c", client_secret: "s" },
      http
    );
    expect(calls[0]).toMatchObject({ kind: "postForm", url: "https://api.crowdstrike.com/oauth2/token" });
    expect(calls[1].url).toBe("https://api.crowdstrike.com/devices/combined/devices/v1?limit=1000");
    expect(calls[1].headers.Authorization).toBe("Bearer fal-tok");
  });
});

// ─── Wiz ───────────────────────────────────────────────────────────────────────

describe("wiz", () => {
  it("normalizes graph nodes by resource type; data stores carry the region", () => {
    const inv = wizAdapter.normalize({
      data: {
        cloudResources: {
          nodes: [
            { id: "w3", name: "orders-db", type: "DATABASE", region: "eu-west-1" },
            { id: "w1", name: "checkout-svc", type: "WEB_SERVICE" },
            { id: "w2", name: "vm-9", type: "VIRTUAL_MACHINE" },
            { id: "w3", name: "dup", type: "DATABASE" }
          ]
        }
      }
    });
    expect(inv.entities.map((e) => [e.external_ref, e.entity_type])).toEqual([
      ["w1", "application"],
      ["w2", "asset"],
      ["w3", "data_store"]
    ]);
    expect(inv.entities[2].data_store).toEqual({ residency_region: "eu-west-1" });
    assertImportableAndSorted(inv);
    expect(wizAdapter.normalize({ data: {} })).toEqual({ entities: [], relationships: [] });
  });

  it("fetch does OAuth then a GraphQL POST with the bearer token", async () => {
    const { http, calls } = fakeHttp({ postForm: { access_token: "wiz-tok" }, postJson: { data: {} } });
    await wizAdapter.fetch({ base_url: "https://api.wiz.io", client_id: "c", client_secret: "s" }, http);
    expect(calls[0]).toMatchObject({ kind: "postForm", url: "https://api.wiz.io/oauth/token" });
    expect(calls[1]).toMatchObject({ kind: "postJson", url: "https://api.wiz.io/graphql" });
    expect(calls[1].headers.Authorization).toBe("Bearer wiz-tok");
    expect((calls[1].body as { query: string }).query).toContain("cloudResources");
  });
});

// ─── Tenable ───────────────────────────────────────────────────────────────────

describe("tenable", () => {
  it("normalizes assets with ACR-mapped criticality; handles array-valued fields", () => {
    const inv = tenableAdapter.normalize({
      assets: [
        { id: "t1", hostname: ["app01"], acr_score: 9, operating_system: ["Ubuntu 22.04"] },
        { id: "t2", fqdn: "db01.corp", acr_score: 7 },
        { id: "t3", hostname: "low01", acr_score: 2 },
        { id: "t4" } // no name → dropped
      ]
    });
    expect(inv.entities.map((e) => [e.external_ref, e.criticality])).toEqual([
      ["t1", "critical"],
      ["t2", "high"],
      ["t3", "low"]
    ]);
    assertImportableAndSorted(inv);
  });

  it("fetch GETs /assets with the X-ApiKeys header", async () => {
    const { http, calls } = fakeHttp({ get: { assets: [] } });
    await tenableAdapter.fetch({ base_url: "https://cloud.tenable.com", access_key: "AK", secret_key: "SK" }, http);
    expect(calls[0].url).toBe("https://cloud.tenable.com/assets");
    expect(calls[0].headers["X-ApiKeys"]).toBe("accessKey=AK;secretKey=SK");
  });
});

// ─── Qualys ────────────────────────────────────────────────────────────────────

describe("qualys", () => {
  it("normalizes ServiceResponse host assets with criticalityScore mapping", () => {
    const inv = qualysAdapter.normalize({
      ServiceResponse: {
        data: [
          { HostAsset: { id: 101, name: "q-host-1", os: "CentOS", criticalityScore: 5 } },
          { HostAsset: { id: 102, name: "q-host-2", criticalityScore: "3" } },
          { notAHost: true },
          { HostAsset: { id: 101, name: "dup" } }
        ]
      }
    });
    expect(inv.entities.map((e) => [e.external_ref, e.criticality])).toEqual([
      ["101", "critical"],
      ["102", "medium"]
    ]);
    assertImportableAndSorted(inv);
  });

  it("fetch GETs the host-asset search with Basic auth", async () => {
    const { http, calls } = fakeHttp({ get: { ServiceResponse: { data: [] } } });
    await qualysAdapter.fetch({ base_url: "https://qualysapi.qualys.com", username: "u", password: "p" }, http);
    expect(calls[0].url).toBe("https://qualysapi.qualys.com/qps/rest/2.0/search/am/hostasset");
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });
});

// ─── Rapid7 InsightVM ──────────────────────────────────────────────────────────

describe("rapid7", () => {
  it("normalizes asset resources with riskScore-mapped criticality; ip fallback name", () => {
    const inv = rapid7Adapter.normalize({
      resources: [
        { id: 1, hostName: "r7-app", riskScore: 25_000 },
        { id: 2, ip: "10.0.0.9", riskScore: 12_000 },
        { id: 3, hostName: "quiet", riskScore: 10 }
      ]
    });
    expect(inv.entities.map((e) => [e.name, e.criticality])).toEqual([
      ["r7-app", "critical"],
      ["10.0.0.9", "high"],
      ["quiet", "low"]
    ]);
    assertImportableAndSorted(inv);
  });

  it("fetch GETs /api/3/assets with the X-Api-Key header", async () => {
    const { http, calls } = fakeHttp({ get: { resources: [] } });
    await rapid7Adapter.fetch({ base_url: "https://insight.rapid7.com", api_token: "tok" }, http);
    expect(calls[0].url).toBe("https://insight.rapid7.com/api/3/assets?size=500");
    expect(calls[0].headers["X-Api-Key"]).toBe("tok");
  });
});

// ─── Cloud inventory ───────────────────────────────────────────────────────────

describe("cloud_inventory", () => {
  it("normalizes a provider-neutral export by resource type; data stores carry region", () => {
    const inv = cloudInventoryAdapter.normalize({
      resources: [
        { id: "arn:s3:reports", name: "reports-bucket", type: "AWS::S3::Bucket", region: "us-east-1" },
        { id: "arn:lambda:etl", name: "etl-fn", type: "AWS::Lambda::Function" },
        { id: "arn:ec2:i-1", name: "bastion", type: "AWS::EC2::Instance" }
      ]
    });
    expect(inv.entities.map((e) => [e.external_ref, e.entity_type])).toEqual([
      ["arn:ec2:i-1", "asset"],
      ["arn:lambda:etl", "application"],
      ["arn:s3:reports", "data_store"]
    ]);
    expect(inv.entities[2].data_store).toEqual({ residency_region: "us-east-1" });
    assertImportableAndSorted(inv);
  });

  it("config validates WITHOUT the export URL, but fetch requires it (typed error)", async () => {
    const config = { provider: "aws", account_id: "123", role_arn_or_credential: "arn:aws:iam::123:role/x" };
    expect("config" in cloudInventoryAdapter.validateConfig(config)).toBe(true);
    const { http } = fakeHttp({ get: {} });
    await expect(cloudInventoryAdapter.fetch(config, http)).rejects.toThrow(/cloud_inventory_requires_export_url/);
  });

  it("fetch GETs the pre-authorized export URL when provided", async () => {
    const { http, calls } = fakeHttp({ get: { resources: [] } });
    await cloudInventoryAdapter.fetch(
      {
        provider: "aws",
        account_id: "123",
        role_arn_or_credential: "ref",
        inventory_export_url: "https://exports.example.com/inv.json"
      },
      http
    );
    expect(calls[0].url).toBe("https://exports.example.com/inv.json");
  });
});

// ─── Identity provider ─────────────────────────────────────────────────────────

describe("identity_provider", () => {
  it("normalizes active users to identity entities; deprovisioned/suspended skipped", () => {
    const inv = identityProviderAdapter.normalize([
      { id: "u2", status: "ACTIVE", profile: { displayName: "Ada Lovelace", login: "ada@corp.io" } },
      { id: "u1", status: "ACTIVE", profile: { login: "grace@corp.io" } },
      { id: "u3", status: "DEPROVISIONED", profile: { displayName: "Gone" } },
      { id: "u4", status: "SUSPENDED", profile: { displayName: "Paused" } },
      { id: "u5", status: "ACTIVE", profile: {} } // no usable name → dropped
    ]);
    expect(inv.entities.map((e) => [e.external_ref, e.entity_type, e.name])).toEqual([
      ["u1", "identity", "grace@corp.io"],
      ["u2", "identity", "Ada Lovelace"]
    ]);
    // The R7 import-path extension: identity is now an importable type.
    expect(IMPORT_ENTITY_TYPES).toContain("identity");
    assertImportableAndSorted(inv);
    expect(identityProviderAdapter.normalize({ not: "array" })).toEqual({ entities: [], relationships: [] });
  });

  it("fetch GETs the Okta users API with the SSWS token", async () => {
    const { http, calls } = fakeHttp({ get: [] });
    await identityProviderAdapter.fetch({ base_url: "https://corp.okta.com", api_token: "sswstok" }, http);
    expect(calls[0].url).toBe("https://corp.okta.com/api/v1/users?limit=200");
    expect(calls[0].headers.Authorization).toBe("SSWS sswstok");
  });
});

// ─── Cross-adapter invariants ──────────────────────────────────────────────────

describe("all implemented adapters", () => {
  const adapters = [
    microsoftDefenderAdapter,
    crowdstrikeFalconAdapter,
    wizAdapter,
    tenableAdapter,
    qualysAdapter,
    rapid7Adapter,
    cloudInventoryAdapter,
    identityProviderAdapter
  ];

  it("normalize is deterministic (same input → deep-equal output)", () => {
    const sample = {
      value: [{ id: "a", computerDnsName: "x" }],
      resources: [{ id: "a", hostname: "x", hostName: "x", device_id: "a" }],
      assets: [{ id: "a", hostname: "x" }],
      data: { cloudResources: { nodes: [{ id: "a", name: "x", type: "VM" }] } },
      ServiceResponse: { data: [{ HostAsset: { id: "a", name: "x" } }] }
    };
    for (const a of adapters) {
      expect(a.normalize(sample)).toEqual(a.normalize(sample));
    }
  });

  it("config validation rejects a missing required field and a non-https URL", () => {
    for (const a of adapters) {
      expect("error" in a.validateConfig({})).toBe(true);
      const urlField = a.configFields.find((f) => f.kind === "url" && f.required);
      if (urlField) {
        const full: Record<string, string> = {};
        for (const f of a.configFields) full[f.key] = f.kind === "url" ? "https://x.example.com" : "v";
        full[urlField.key] = "http://insecure.example.com";
        expect(a.validateConfig(full)).toMatchObject({ error: "config_field_url" });
      }
    }
  });
});
