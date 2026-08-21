/**
 * assetOccurrenceImport.test.ts — attaching an imported vulnerability to a host.
 *
 * THE RULE THIS FILE EXISTS FOR: the importer must never invent an asset. A
 * scan row naming a host SecureLogic has never heard of imports the
 * vulnerability WITHOUT an occurrence — a vulnerability with no asset is a valid
 * record, and creating a placeholder host to satisfy the occurrence model would
 * put fiction in the inventory that every later report would treat as real.
 *
 * The second rule is that an IP address is a lease, not a name, so a row
 * identified only by IP is warned about rather than silently unattached.
 */
import { describe, it, expect } from "vitest";

import { __testing } from "../FindingsImportClient";

const { normalizeRow, validateRow, cleanRow } = __testing;

const MAP = {
  title: "Title",
  severity: "Severity",
  source_type: "Source",
  asset_hostname: "Host",
  asset_fqdn: "DNS Name",
  asset_ip: "IP",
  asset_cloud_resource_id: "ARN",
  asset_internal_id: "CMDB ID",
};

const row = (over: Record<string, string> = {}) =>
  normalizeRow(
    {
      Title: "Apache Struts RCE",
      Severity: "Critical",
      Source: "vulnerability",
      ...over,
    },
    MAP as never,
  );

describe("asset identifiers are carried through the importer", () => {
  it("captures every supported identifier column", () => {
    const r = row({
      Host: "web01",
      "DNS Name": "web01.corp.example",
      IP: "10.0.4.12",
      ARN: "arn:aws:ec2:us-east-1:1:instance/i-abc",
      "CMDB ID": "ASSET-0042",
    });
    expect(r.asset_hostname).toBe("web01");
    expect(r.asset_fqdn).toBe("web01.corp.example");
    expect(r.asset_ip).toBe("10.0.4.12");
    expect(r.asset_cloud_resource_id).toBe("arn:aws:ec2:us-east-1:1:instance/i-abc");
    expect(r.asset_internal_id).toBe("ASSET-0042");
  });

  it("survives cleanRow, which is what actually gets sent", () => {
    const c = cleanRow(row({ Host: "web01", "CMDB ID": "ASSET-0042" }));
    expect(c.asset_hostname).toBe("web01");
    expect(c.asset_internal_id).toBe("ASSET-0042");
  });

  it("omits identifiers that were not supplied rather than sending empty strings", () => {
    const c = cleanRow(row({ Host: "web01" }));
    expect(c.asset_hostname).toBe("web01");
    expect(c.asset_fqdn).toBeUndefined();
    expect(c.asset_ip).toBeUndefined();
  });
});

describe("a vulnerability with no asset is valid", () => {
  it("a row naming no host imports cleanly with no warning about assets", () => {
    const v = validateRow(row());
    expect(v.status).toBe("valid");
    expect(v.warnings.join(" ")).not.toMatch(/asset/i);
  });

  it("carries no asset fields when none were mapped", () => {
    const c = cleanRow(row());
    expect(c.asset_hostname).toBeUndefined();
    expect(c.asset_internal_id).toBeUndefined();
  });
});

describe("an IP alone cannot identify a host", () => {
  it("warns that the row will import without an affected asset", () => {
    const v = validateRow(row({ IP: "10.0.4.12" }));
    expect(v.status).toBe("warning");
    expect(v.warnings.join(" ")).toMatch(/cannot identify an asset on its own/i);
    // Warned, NOT rejected — the vulnerability itself is perfectly good data.
    expect(v.status).not.toBe("invalid");
  });

  it("does NOT warn when a resolvable identifier accompanies the IP", () => {
    for (const companion of [
      { Host: "web01" },
      { "DNS Name": "web01.corp.example" },
      { ARN: "arn:aws:ec2:us-east-1:1:instance/i-abc" },
      { "CMDB ID": "ASSET-0042" },
    ]) {
      const v = validateRow(row({ IP: "10.0.4.12", ...companion }));
      expect(v.warnings.join(" ")).not.toMatch(/cannot identify an asset/i);
    }
  });
});
