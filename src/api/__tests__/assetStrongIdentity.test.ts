/**
 * assetStrongIdentity.test.ts — the PLAT-ASSET-1 allowlist is exact.
 *
 * These tests are the executable form of the operator ruling: what qualifies
 * for automatic asset creation is a closed, deterministic set. Every case
 * here is a policy statement — a new grammar or a loosened one must show up
 * as a reviewed change to this file.
 */
import { describe, expect, it } from "vitest";

import {
  STRONG_IDENTITY_SCHEME,
  classifyStrongIdentity
} from "../lib/assetStrongIdentity.js";

describe("classifyStrongIdentity — scheme gate", () => {
  it("only cloud_resource_id can ever qualify", () => {
    // An ARN under any other scheme is NOT a strong identity — the scheme is
    // the claim's namespace declaration and we do not second-guess it.
    const arn = "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123def456";
    for (const scheme of [
      "internal_id",
      "hostname",
      "fqdn",
      "ip",
      "mac",
      "instance_id",
      "application_id",
      "scanner_asset_id"
    ]) {
      expect(classifyStrongIdentity(scheme, arn)).toBeNull();
    }
    expect(classifyStrongIdentity(STRONG_IDENTITY_SCHEME, arn)).not.toBeNull();
  });

  it("empty and whitespace values never qualify", () => {
    expect(classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "")).toBeNull();
    expect(classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "   ")).toBeNull();
  });
});

describe("AWS ARN grammar", () => {
  it("parses a standard regional ARN", () => {
    const r = classifyStrongIdentity(
      STRONG_IDENTITY_SCHEME,
      "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123def456"
    );
    expect(r).toMatchObject({
      provider: "aws",
      accountId: "123456789012",
      region: "us-east-1",
      resourceType: "ec2",
      derivedName: "i-0abc123def456"
    });
    expect(r!.normalizedValue).toBe(
      "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123def456"
    );
  });

  it("tolerates the degenerate-LEGAL forms: S3 (no region, no account)", () => {
    const r = classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "arn:aws:s3:::my-bucket");
    expect(r).toMatchObject({
      provider: "aws",
      accountId: null,
      region: null,
      resourceType: "s3",
      derivedName: "my-bucket"
    });
  });

  it("tolerates IAM ARNs (no region)", () => {
    const r = classifyStrongIdentity(
      STRONG_IDENTITY_SCHEME,
      "arn:aws:iam::123456789012:role/deploy-role"
    );
    expect(r).toMatchObject({
      provider: "aws",
      accountId: "123456789012",
      region: null,
      derivedName: "deploy-role"
    });
  });

  it("accepts aws-cn and aws-us-gov partitions", () => {
    expect(
      classifyStrongIdentity(
        STRONG_IDENTITY_SCHEME,
        "arn:aws-cn:ec2:cn-north-1:123456789012:instance/i-1"
      )?.provider
    ).toBe("aws");
    expect(
      classifyStrongIdentity(
        STRONG_IDENTITY_SCHEME,
        "arn:aws-us-gov:s3:::gov-bucket"
      )?.provider
    ).toBe("aws");
  });

  it("preserves case — ARN resource parts are case-sensitive", () => {
    const r = classifyStrongIdentity(
      STRONG_IDENTITY_SCHEME,
      "arn:aws:s3:::My-Bucket"
    );
    expect(r!.normalizedValue).toBe("arn:aws:s3:::My-Bucket");
  });

  it("refuses non-numeric account ids and empty resources", () => {
    expect(
      classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "arn:aws:ec2:us-east-1:notanaccount:instance/i-1")
    ).toBeNull();
    expect(classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "arn:aws:s3:::")).toBeNull();
  });
});

describe("Azure ARM grammar", () => {
  const vm =
    "/subscriptions/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/web01";

  it("parses a full resource id and lowercases it (ARM ids are case-insensitive)", () => {
    const r = classifyStrongIdentity(STRONG_IDENTITY_SCHEME, vm);
    expect(r).toMatchObject({
      provider: "azure",
      accountId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
      region: null,
      resourceType: "microsoft.compute/virtualmachines",
      derivedName: "web01"
    });
    expect(r!.normalizedValue).toBe(vm.toLowerCase());
  });

  it("folds case variants to ONE normalized value — one resource, one asset", () => {
    const upper = vm.toUpperCase().replace("/SUBSCRIPTIONS/", "/subscriptions/");
    const a = classifyStrongIdentity(STRONG_IDENTITY_SCHEME, vm);
    const b = classifyStrongIdentity(STRONG_IDENTITY_SCHEME, upper);
    expect(b).not.toBeNull();
    expect(b!.normalizedValue).toBe(a!.normalizedValue);
  });

  it("accepts a bare subscription id (the subscription is itself a resource)", () => {
    const r = classifyStrongIdentity(
      STRONG_IDENTITY_SCHEME,
      "/subscriptions/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"
    );
    expect(r?.provider).toBe("azure");
    expect(r?.resourceType).toBeNull();
  });

  it("refuses a non-GUID subscription segment", () => {
    expect(
      classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "/subscriptions/not-a-guid/resourceGroups/rg")
    ).toBeNull();
  });

  it("refuses empty path segments", () => {
    expect(
      classifyStrongIdentity(
        STRONG_IDENTITY_SCHEME,
        "/subscriptions/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0//providers"
      )
    ).toBeNull();
  });
});

describe("GCP full asset name grammar", () => {
  it("parses a Cloud Asset Inventory name", () => {
    const r = classifyStrongIdentity(
      STRONG_IDENTITY_SCHEME,
      "//compute.googleapis.com/projects/my-project/zones/us-central1-a/instances/web01"
    );
    expect(r).toMatchObject({
      provider: "gcp",
      accountId: "my-project",
      resourceType: "compute.googleapis.com",
      derivedName: "web01"
    });
  });

  it("keeps case — GCP names are case-sensitive", () => {
    const v = "//storage.googleapis.com/projects/_/buckets/My-Bucket";
    expect(classifyStrongIdentity(STRONG_IDENTITY_SCHEME, v)!.normalizedValue).toBe(v);
  });

  it("refuses non-googleapis hosts", () => {
    expect(
      classifyStrongIdentity(STRONG_IDENTITY_SCHEME, "//evil.example.com/projects/p/instances/i")
    ).toBeNull();
  });
});

describe("unqualified values — the review-queue routing", () => {
  it.each([
    ["a bare EC2 instance id", "i-0abc123def456"],
    ["a scanner's freeform label", "PROD-WEB-01 (scanner import)"],
    ["a hostname", "web01.corp.example.com"],
    ["an ARN with a bad partition", "arn:not-aws:ec2:us-east-1:123456789012:instance/i-1"],
    ["a UUID alone", "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"],
    ["an http URL", "https://portal.azure.com/#resource/subscriptions/x"]
  ])("%s does not qualify", (_label, value) => {
    expect(classifyStrongIdentity(STRONG_IDENTITY_SCHEME, value)).toBeNull();
  });
});
