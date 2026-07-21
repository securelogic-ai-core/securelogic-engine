/**
 * assetImportPlan.test.ts — EAR P16: the detail-backed asset import planner.
 *
 * Asserts (a) adaptAssetRow reuses the existing create-validator (no second
 * validation truth), and (b) planAssetImport applies the SHARED dedup/cap
 * precedence (invalid → duplicate_in_file → duplicate_in_db → cap_exceeded → ok).
 */

import { describe, expect, it } from "vitest";
import { adaptAssetRow, planAssetImport, assetImportColumns } from "../lib/assetImportPlan.js";
import type { ImportRow } from "../lib/enterpriseContextImport.js";

describe("adaptAssetRow — reuses validateAssetDetailCreate", () => {
  it("cloud_resource: valid row normalizes with typed columns + dedup key", () => {
    const r = adaptAssetRow("cloud_resource", {
      name: "  Prod Bucket ",
      provider: "aws",
      region: "us-east-1",
      criticality: "high",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.key).toBe("prod bucket");
      expect(r.normalized.asset_type).toBe("cloud_resource");
      expect(r.normalized.name).toBe("Prod Bucket");
      expect(r.normalized.typed.provider).toBe("aws");
      expect(r.normalized.typed.region).toBe("us-east-1");
      expect(r.normalized.criticality).toBe("high");
    }
  });

  it("cloud_resource: missing required provider → provider_required", () => {
    const r = adaptAssetRow("cloud_resource", { name: "x" });
    expect(r).toMatchObject({ ok: false, error: "provider_required" });
  });

  it("cloud_resource: provider outside the vocabulary → provider_invalid", () => {
    const r = adaptAssetRow("cloud_resource", { name: "x", provider: "digitalocean" });
    expect(r).toMatchObject({ ok: false, error: "provider_invalid" });
  });

  it("blank name → name_required", () => {
    const r = adaptAssetRow("endpoint", { name: "   " });
    expect(r).toMatchObject({ ok: false, error: "name_required" });
  });

  it("api: enum typed column validated (auth_method)", () => {
    const ok = adaptAssetRow("api", { name: "billing", protocol: "rest", auth_method: "oauth2" });
    expect(ok.ok).toBe(true);
    const bad = adaptAssetRow("api", { name: "billing", auth_method: "sorcery" });
    expect(bad).toMatchObject({ ok: false, error: "auth_method_invalid" });
  });
});

function rows(...names: Array<Record<string, string>>): ImportRow[] {
  return names;
}

describe("planAssetImport — shared precedence", () => {
  it("classifies invalid / duplicate_in_file / duplicate_in_db / cap_exceeded / ok in order", () => {
    const input = rows(
      { name: "a", provider: "aws" }, // ok
      { name: "b", provider: "aws" }, // ok
      { name: "A", provider: "aws" }, // duplicate_in_file (case-insensitive key of 'a')
      { name: "existing", provider: "aws" }, // duplicate_in_db
      { name: "c" }, // invalid — provider missing
      { name: "d", provider: "aws" }, // cap_exceeded (headroom = 2)
    );
    const plan = planAssetImport({
      assetType: "cloud_resource",
      rows: input,
      existingKeys: new Set(["existing"]),
      capHeadroom: 2,
    });

    expect(plan.rows.map((r) => r.status)).toEqual([
      "ok",
      "ok",
      "duplicate_in_file",
      "duplicate_in_db",
      "invalid",
      "cap_exceeded",
    ]);
    expect(plan.summary).toEqual({ total: 6, ok: 2, invalid: 1, duplicate: 2, cap_exceeded: 1 });
    // Only ok rows carry a normalized payload for commit.
    expect(plan.rows[0]!.normalized?.name).toBe("a");
    expect(plan.rows[4]!.normalized).toBeUndefined();
  });

  it("zero headroom → every otherwise-ok row is cap_exceeded", () => {
    const plan = planAssetImport({
      assetType: "endpoint",
      rows: rows({ name: "h1" }, { name: "h2" }),
      existingKeys: new Set(),
      capHeadroom: 0,
    });
    expect(plan.summary.ok).toBe(0);
    expect(plan.summary.cap_exceeded).toBe(2);
  });
});

describe("assetImportColumns", () => {
  it("lists base columns then the type's typed columns", () => {
    expect(assetImportColumns("cloud_resource")).toEqual([
      "name",
      "criticality",
      "status",
      "external_ref",
      "provider",
      "account_id",
      "region",
      "resource_type",
    ]);
    expect(assetImportColumns("identity_system")).toEqual([
      "name",
      "criticality",
      "status",
      "external_ref",
      "idp_vendor",
      "protocol",
    ]);
  });
});
