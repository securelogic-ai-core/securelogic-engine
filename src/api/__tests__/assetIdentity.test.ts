/**
 * assetIdentity.test.ts — the rules that stop a vulnerability landing on the
 * wrong host.
 *
 * An occurrence attached to the wrong asset is worse than no occurrence: it
 * reports exposure someone will act on, and it looks exactly like a correct
 * record. So the interesting tests here are the REFUSALS.
 */

import { describe, expect, it } from "vitest";

import {
  RESOLUTION_PRECEDENCE,
  VOLATILE_SCHEMES,
  normalizeIdentifierValue,
  resolvableClaims,
  resolveAsset,
  type IdentifierMatch,
} from "../lib/assetIdentity.js";

const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const match = (assetId: string, scheme: string, value: string, source = "scanner-x"): IdentifierMatch =>
  ({ assetId, scheme, value, source });

describe("volatile identifiers never resolve", () => {
  it("an IP address alone cannot identify an asset", () => {
    const r = resolveAsset([{ scheme: "ip", value: "10.0.4.12" }], [match(A, "ip", "10.0.4.12")]);
    expect(r.outcome).toBe("not_found");
    expect(r.reason).toMatch(/IP or MAC/i);
  });

  it("a MAC address alone cannot identify an asset", () => {
    const r = resolveAsset([{ scheme: "mac", value: "00:11:22:33:44:55" }],
      [match(A, "mac", "00:11:22:33:44:55")]);
    expect(r.outcome).toBe("not_found");
  });

  it("an IP alongside a real identifier is ignored, not blended", () => {
    const r = resolveAsset(
      [{ scheme: "ip", value: "10.0.4.12" }, { scheme: "fqdn", value: "web01.corp.example" }],
      [match(A, "fqdn", "web01.corp.example"), match(B, "ip", "10.0.4.12")],
    );
    expect(r).toMatchObject({ outcome: "resolved", assetId: A, via: "fqdn" });
  });

  it("ip and mac are excluded from the resolvable set and the precedence list", () => {
    expect(resolvableClaims([{ scheme: "ip", value: "1.2.3.4" }])).toHaveLength(0);
    for (const s of VOLATILE_SCHEMES) {
      expect(RESOLUTION_PRECEDENCE).not.toContain(s);
    }
  });
});

describe("ambiguity refuses rather than guessing", () => {
  it("two assets sharing a hostname produce ambiguous, not a pick", () => {
    const r = resolveAsset([{ scheme: "hostname", value: "web01" }],
      [match(A, "hostname", "web01"), match(B, "hostname", "web01")]);
    expect(r.outcome).toBe("ambiguous");
    if (r.outcome === "ambiguous") {
      expect(r.assetIds.sort()).toEqual([A, B].sort());
      expect(r.via).toBe("hostname");
    }
  });

  it("an ambiguous STRONG scheme does not fall through to a weaker one", () => {
    // Falling through would reintroduce the guess by the back door: the FQDN is
    // genuinely contested, and a hostname match is not better evidence.
    const r = resolveAsset(
      [{ scheme: "fqdn", value: "web01.corp.example" }, { scheme: "hostname", value: "web01" }],
      [
        match(A, "fqdn", "web01.corp.example"),
        match(B, "fqdn", "web01.corp.example"),
        match(A, "hostname", "web01"),
      ],
    );
    expect(r.outcome).toBe("ambiguous");
    if (r.outcome === "ambiguous") expect(r.via).toBe("fqdn");
  });

  it("the same asset matched twice is NOT ambiguous", () => {
    const r = resolveAsset([{ scheme: "hostname", value: "web01" }],
      [match(A, "hostname", "web01", "scanner-x"), match(A, "hostname", "web01", "scanner-y")]);
    expect(r).toMatchObject({ outcome: "resolved", assetId: A });
  });
});

describe("precedence: a stronger identity wins", () => {
  it("cloud_resource_id beats hostname when they disagree", () => {
    const r = resolveAsset(
      [{ scheme: "hostname", value: "web01" },
       { scheme: "cloud_resource_id", value: "arn:aws:ec2:us-east-1:1:instance/i-abc" }],
      [match(B, "hostname", "web01"),
       match(A, "cloud_resource_id", "arn:aws:ec2:us-east-1:1:instance/i-abc")],
    );
    expect(r).toMatchObject({ outcome: "resolved", assetId: A, via: "cloud_resource_id" });
  });

  it("hostname is the weakest resolvable scheme", () => {
    expect(RESOLUTION_PRECEDENCE[RESOLUTION_PRECEDENCE.length - 1]).toBe("hostname");
  });
});

describe("a scanner's asset id is scoped to that scanner", () => {
  it("matches only within the same source", () => {
    const r = resolveAsset(
      [{ scheme: "scanner_asset_id", value: "123", source: "tenable" }],
      [match(A, "scanner_asset_id", "123", "tenable")],
    );
    expect(r).toMatchObject({ outcome: "resolved", assetId: A });
  });

  it("does NOT match another scanner's identically numbered asset", () => {
    // Two products both numbering assets from 1 is the default, not a coincidence.
    const r = resolveAsset(
      [{ scheme: "scanner_asset_id", value: "123", source: "tenable" }],
      [match(B, "scanner_asset_id", "123", "qualys")],
    );
    expect(r.outcome).toBe("not_found");
  });

  it("a claim with no source cannot match a source-scoped scheme", () => {
    const r = resolveAsset([{ scheme: "scanner_asset_id", value: "123" }],
      [match(A, "scanner_asset_id", "123", "tenable")]);
    expect(r.outcome).toBe("not_found");
  });
});

describe("normalization", () => {
  it("hostnames and FQDNs are case-insensitive", () => {
    expect(normalizeIdentifierValue("hostname", "  WEB01 ")).toBe("web01");
    expect(normalizeIdentifierValue("fqdn", "Web01.Corp.Example")).toBe("web01.corp.example");
    const r = resolveAsset([{ scheme: "hostname", value: "WEB01" }], [match(A, "hostname", "web01")]);
    expect(r).toMatchObject({ outcome: "resolved", assetId: A });
  });

  it("case-sensitive schemes are left alone", () => {
    // An ARN and a CMDB id are opaque strings; lower-casing them would break them.
    expect(normalizeIdentifierValue("cloud_resource_id", " arn:AWS:Thing ")).toBe("arn:AWS:Thing");
    expect(normalizeIdentifierValue("internal_id", "ASSET-0042")).toBe("ASSET-0042");
  });
});

describe("no match at all", () => {
  it("reports not_found rather than inventing an asset", () => {
    const r = resolveAsset([{ scheme: "hostname", value: "unknown-host" }], []);
    expect(r.outcome).toBe("not_found");
  });

  it("empty claims resolve to not_found", () => {
    expect(resolveAsset([], []).outcome).toBe("not_found");
  });
});
