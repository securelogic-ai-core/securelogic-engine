/**
 * directoryAdapters.test.ts — ERIP E2.P6: the wave-2 adapters (Microsoft Graph,
 * Google Workspace, GitHub, Jamf) — config validation, fetch auth flow with
 * fakes, pure normalize + entity-type routing, + registry/migration lockstep.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

import { microsoftGraphAdapter } from "../lib/connectors/microsoftGraph.js";
import { googleWorkspaceAdapter } from "../lib/connectors/googleWorkspace.js";
import { githubAdapter } from "../lib/connectors/github.js";
import { jamfAdapter } from "../lib/connectors/jamf.js";
import { getConnector, REQUIRED_CONNECTOR_IDS } from "../lib/connectors/registry.js";
import { mintServiceAccountAssertion, decodeClaims } from "../lib/connectors/gcpServiceAccountJwt.js";
import type { HttpClient } from "../lib/connectors/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, "../../../db/migrations/20260814_connectors_directory_adapters.sql");

describe("registry — wave-2 adapters", () => {
  it("registers all four and lists them in REQUIRED_CONNECTOR_IDS", () => {
    for (const id of ["microsoft_graph", "google_workspace", "github", "jamf"]) {
      expect(getConnector(id)).toBeDefined();
      expect(REQUIRED_CONNECTOR_IDS).toContain(id);
    }
  });

  it("the 20260814 CHECK admits the four new ids and keeps the prior twelve", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const id of REQUIRED_CONNECTOR_IDS) expect(sql, id).toContain(`'${id}'`);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });
});

describe("microsoft_graph adapter", () => {
  it("OAuth then devices → endpoint-bound assets with os metadata", async () => {
    let tokenCalled = false;
    const http: HttpClient = {
      async getJson(url) {
        expect(url).toContain("/v1.0/devices");
        return { value: [{ id: "d1", displayName: "LAPTOP-1", operatingSystem: "Windows", operatingSystemVersion: "11" }] };
      },
      async postForm() { tokenCalled = true; return { access_token: "tok" }; }
    };
    const raw = await microsoftGraphAdapter.fetch({ tenant_id: "t", client_id: "c", client_secret: "s" }, http);
    expect(tokenCalled).toBe(true);
    const inv = microsoftGraphAdapter.normalize(raw);
    expect(inv.entities[0]).toMatchObject({ entity_type: "asset", name: "LAPTOP-1", external_ref: "d1" });
    expect(inv.entities[0].metadata).toMatchObject({ os: "Windows 11" });
  });
});

describe("google_workspace adapter", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  it("mints a domain-wide-delegation assertion (sub = admin) and lists directory users", async () => {
    let assertion = "";
    const http: HttpClient = {
      async getJson(url) {
        expect(url).toContain("/users?customer=my_customer");
        return {
          users: [
            { id: "u1", primaryEmail: "a@corp.com", name: { fullName: "Alice" }, suspended: false },
            { id: "u2", primaryEmail: "b@corp.com", name: { fullName: "Bob" }, suspended: true }
          ]
        };
      },
      async postForm(_url, _headers, form) { assertion = form.assertion; return { access_token: "tok" }; }
    };
    const raw = await googleWorkspaceAdapter.fetch(
      { client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey, admin_email: "admin@corp.com", customer_id: "my_customer" },
      http
    );
    expect(decodeClaims(assertion).sub).toBe("admin@corp.com"); // impersonation subject
    const inv = googleWorkspaceAdapter.normalize(raw);
    // Suspended user skipped; active user → identity entity.
    expect(inv.entities).toHaveLength(1);
    expect(inv.entities[0]).toMatchObject({ entity_type: "identity", name: "Alice", external_ref: "u1" });
  });

  it("the minted assertion carries the impersonation subject", () => {
    const token = mintServiceAccountAssertion({
      clientEmail: "sa@p.iam.gserviceaccount.com",
      privateKeyPem: privateKey,
      scope: "s",
      subject: "admin@corp.com",
      iat: 1_780_000_000
    });
    expect(decodeClaims(token)).toMatchObject({ iss: "sa@p.iam.gserviceaccount.com", sub: "admin@corp.com" });
  });
});

describe("github adapter", () => {
  it("lists org repos → application entities (import lane)", async () => {
    const http: HttpClient = {
      async getJson(url) {
        expect(url).toContain("/orgs/acme/repos");
        return [
          { id: 100, name: "svc", full_name: "acme/svc", description: "billing service", archived: false },
          { id: 101, name: "old", full_name: "acme/old", archived: true }
        ];
      }
    };
    const raw = await githubAdapter.fetch({ base_url: "https://api.github.com", org: "acme", token: "t" }, http);
    const inv = githubAdapter.normalize(raw);
    expect(inv.entities.map((e) => e.entity_type)).toEqual(["application", "application"]);
    expect(inv.entities.map((e) => e.external_ref)).toEqual(["github:100", "github:101"]);
    expect(inv.entities.find((e) => e.external_ref === "github:101")?.metadata).toMatchObject({ archived: "true" });
  });
});

describe("jamf adapter", () => {
  it("OAuth then computers-inventory → endpoint-bound assets", async () => {
    let tokenUrl = "";
    const http: HttpClient = {
      async getJson(url) {
        expect(url).toContain("/api/v1/computers-inventory");
        return { results: [{ id: 7, general: { name: "MBP-7" }, operatingSystem: { version: "14.5" } }] };
      },
      async postForm(url) { tokenUrl = url; return { access_token: "tok" }; }
    };
    const raw = await jamfAdapter.fetch({ base_url: "https://corp.jamfcloud.com", client_id: "c", client_secret: "s" }, http);
    expect(tokenUrl).toContain("/api/oauth/token");
    const inv = jamfAdapter.normalize(raw);
    expect(inv.entities[0]).toMatchObject({ entity_type: "asset", name: "MBP-7", external_ref: "jamf:7" });
    expect(inv.entities[0].metadata).toMatchObject({ os: "macOS 14.5" });
  });
});
