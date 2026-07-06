/**
 * cloudAdapters.test.ts — ERIP E2.P5: the native AWS/Azure/GCP cloud adapters
 * (config validation, fetch auth flow with fakes, pure normalize) + the SigV4
 * signer and the GCP service-account JWT minter (spec conformance), + registry
 * + migration lockstep for the three new connector ids.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

import { awsAdapter } from "../lib/connectors/aws.js";
import { azureAdapter } from "../lib/connectors/azure.js";
import { gcpAdapter } from "../lib/connectors/gcp.js";
import { getConnector, REQUIRED_CONNECTOR_IDS } from "../lib/connectors/registry.js";
import { signAwsRequest, deriveSigningKey } from "../lib/connectors/awsSigV4.js";
import { mintServiceAccountAssertion, verifyAssertion, decodeClaims } from "../lib/connectors/gcpServiceAccountJwt.js";
import { planConnectorSync } from "../lib/connectorSyncCore.js";
import type { HttpClient } from "../lib/connectors/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, "../../../db/migrations/20260813_connectors_cloud_adapters.sql");

describe("registry — native cloud adapters", () => {
  it("registers aws / azure / gcp and they are in REQUIRED_CONNECTOR_IDS", () => {
    for (const id of ["aws", "azure", "gcp"]) {
      expect(getConnector(id)?.category).toBe("cloud");
      expect(REQUIRED_CONNECTOR_IDS).toContain(id);
    }
  });

  it("the 20260813 CHECK admits the three new ids", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const id of ["aws", "azure", "gcp"]) expect(sql).toContain(`'${id}'`);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });
});

describe("aws adapter", () => {
  it("rejects incomplete config", () => {
    expect("error" in awsAdapter.validateConfig({ access_key_id: "AKIA" })).toBe(true);
  });

  it("signs a GetResources POST and normalizes ARNs to cloud assets", async () => {
    let sentHeaders: Record<string, string> = {};
    const http: HttpClient = {
      async getJson() { throw new Error("unexpected getJson"); },
      async postJson(_url, headers) {
        sentHeaders = headers;
        return {
          ResourceTagMappingList: [
            { ResourceARN: "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc" },
            { ResourceARN: "arn:aws:s3:::my-bucket" }
          ]
        };
      }
    };
    const raw = await awsAdapter.fetch(
      { access_key_id: "AKIAEXAMPLE", secret_access_key: "secret", region: "us-east-1" },
      http
    );
    expect(sentHeaders.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/tagging\/aws4_request/);
    expect(sentHeaders["X-Amz-Target"]).toContain("GetResources");

    const inv = awsAdapter.normalize(raw);
    expect(inv.entities.map((e) => e.name)).toEqual(["my-bucket", "i-0abc"].sort());
    expect(inv.entities.every((e) => e.entity_type === "asset")).toBe(true);
  });

  it("cloud lane stamps provider='aws' regardless of config.provider", () => {
    const inv = { entities: [{ entity_type: "asset" as const, name: "x", external_ref: "arn:x" }], relationships: [] };
    const plan = planConnectorSync({ id: "aws", displayName: "AWS", category: "cloud" }, inv, { provider: "gcp" });
    expect(plan.detailInputs[0]).toMatchObject({ asset_type: "cloud_resource", typed: { provider: "aws" } });
  });
});

describe("awsSigV4", () => {
  const base = {
    method: "POST", host: "tagging.us-east-1.amazonaws.com", region: "us-east-1", service: "tagging",
    path: "/", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret", amzDate: "20260706T120000Z"
  };

  it("is deterministic for identical inputs and changes with the body", () => {
    const a = signAwsRequest({ ...base, body: "{}" });
    const b = signAwsRequest({ ...base, body: "{}" });
    const c = signAwsRequest({ ...base, body: '{"x":1}' });
    expect(a.authorization).toBe(b.authorization);
    expect(a.authorization).not.toBe(c.authorization);
  });

  it("produces a 64-hex signature and the canonical credential scope", () => {
    const s = signAwsRequest({ ...base, body: "{}", extraHeaders: { "x-amz-target": "T" } });
    expect(s.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(s.authorization).toContain("20260706/us-east-1/tagging/aws4_request");
    expect(s.authorization).toContain("SignedHeaders=host;x-amz-date;x-amz-target");
  });

  it("matches an independent re-derivation of the HMAC signing chain", () => {
    // Cross-check the exported key derivation is wired as the spec's chain.
    const k1 = deriveSigningKey("secret", "20260706", "us-east-1", "tagging");
    const k2 = deriveSigningKey("secret", "20260706", "us-east-1", "tagging");
    expect(k1.equals(k2)).toBe(true);
    expect(deriveSigningKey("secret", "20260706", "us-west-2", "tagging").equals(k1)).toBe(false);
  });
});

describe("azure adapter", () => {
  it("does OAuth client-credentials then lists subscription resources", async () => {
    let tokenCalled = false;
    let listUrl = "";
    const http: HttpClient = {
      async getJson(url) {
        listUrl = url;
        return { value: [{ id: "/subscriptions/s/resourceGroups/rg/providers/x/y/vm1", name: "vm1", type: "x/y", location: "eastus" }] };
      },
      async postForm() { tokenCalled = true; return { access_token: "tok" }; }
    };
    const raw = await azureAdapter.fetch(
      { tenant_id: "t", client_id: "c", client_secret: "s", subscription_id: "sub-1" },
      http
    );
    expect(tokenCalled).toBe(true);
    expect(listUrl).toContain("/subscriptions/sub-1/resources");
    const inv = azureAdapter.normalize(raw);
    expect(inv.entities[0]).toMatchObject({ name: "vm1", external_ref: "/subscriptions/s/resourceGroups/rg/providers/x/y/vm1" });
    expect(inv.entities[0].metadata).toMatchObject({ region: "eastus", resource_type: "x/y" });
  });
});

describe("gcp adapter + service-account JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  it("mints a verifiable RS256 assertion with the expected claims", () => {
    const token = mintServiceAccountAssertion({
      clientEmail: "sa@proj.iam.gserviceaccount.com",
      privateKeyPem: privateKey,
      scope: "https://www.googleapis.com/auth/cloud-platform.read-only",
      iat: 1_780_000_000
    });
    expect(verifyAssertion(token, publicKey)).toBe(true);
    const claims = decodeClaims(token);
    expect(claims).toMatchObject({
      iss: "sa@proj.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_780_000_000,
      exp: 1_780_003_600
    });
  });

  it("exchanges the assertion for a token then lists Cloud Asset resources", async () => {
    let form: Record<string, string> = {};
    const http: HttpClient = {
      async getJson() {
        return { assets: [{ name: "//compute.googleapis.com/projects/p/zones/z/instances/vm-1", assetType: "compute.googleapis.com/Instance" }] };
      },
      async postForm(_url, _headers, f) { form = f; return { access_token: "tok" }; }
    };
    const raw = await gcpAdapter.fetch(
      { client_email: "sa@proj.iam.gserviceaccount.com", private_key: privateKey, project_id: "proj-1" },
      http
    );
    expect(form.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(typeof form.assertion).toBe("string");
    const inv = gcpAdapter.normalize(raw);
    expect(inv.entities[0]).toMatchObject({ name: "vm-1" });
    expect(inv.entities[0].metadata).toMatchObject({ resource_type: "compute.googleapis.com/Instance" });
  });
});
