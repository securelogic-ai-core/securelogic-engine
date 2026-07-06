/**
 * assetRegistry.test.ts — EAR Phase 4: pure helpers behind the unified
 * /assets surface. The ASSET_TYPES vocabulary must mirror the engine contract
 * (src/api/lib/assetRegistry.ts); assetDetailHref encodes EAR-AD-1 (per-type
 * pages stay authoritative — detail-backed kinds have no page yet).
 */

import { describe, it, expect } from "vitest";
import {
  ASSET_TYPES,
  isAssetType,
  assetTypeLabel,
  assetDetailHref,
  assetsReadFailure,
} from "../assetRegistry";

describe("asset type vocabulary", () => {
  it("mirrors the engine's ten canonical types", () => {
    expect([...ASSET_TYPES]).toEqual([
      "vendor",
      "ai_system",
      "application",
      "database",
      "cloud_resource",
      "endpoint",
      "api",
      "identity_system",
      "business_process",
      "generic",
    ]);
  });

  it("isAssetType accepts every type and rejects junk", () => {
    for (const t of ASSET_TYPES) expect(isAssetType(t)).toBe(true);
    expect(isAssetType("server")).toBe(false);
    expect(isAssetType(undefined)).toBe(false);
    expect(isAssetType(3)).toBe(false);
  });

  it("every type has a human label; unknown values pass through", () => {
    for (const t of ASSET_TYPES) {
      expect(assetTypeLabel(t)).not.toBe(t.includes("_") ? t : "");
      expect(assetTypeLabel(t).length).toBeGreaterThan(0);
    }
    expect(assetTypeLabel("ai_system")).toBe("AI System");
    expect(assetTypeLabel("mystery")).toBe("mystery");
  });
});

describe("assetDetailHref (EAR-AD-1 deep links)", () => {
  it("links the three pre-registry backing kinds to their authoritative pages", () => {
    expect(assetDetailHref({ backing_kind: "vendors", backing_id: "v1", asset_id: "r1" })).toBe("/vendors/v1");
    expect(assetDetailHref({ backing_kind: "ai_systems", backing_id: "a1", asset_id: "r2" })).toBe("/ai-systems/a1");
    expect(assetDetailHref({ backing_kind: "enterprise_entities", backing_id: "e1", asset_id: "r3" })).toBe(
      "/enterprise-context/entities/e1",
    );
  });

  it("detail-backed kinds are homed on the unified surface (EAR P6)", () => {
    for (const kind of ["cloud_resources", "endpoints", "apis", "identity_systems"]) {
      expect(assetDetailHref({ backing_kind: kind, backing_id: "x", asset_id: "reg-9" })).toBe("/assets/reg-9");
    }
    expect(assetDetailHref({ backing_kind: "mystery", backing_id: "x", asset_id: "r" })).toBeNull();
  });
});

describe("assetsReadFailure", () => {
  it("classifies disabled / capability / error", () => {
    expect(assetsReadFailure({ disabled: true, error: "http_404" }).kind).toBe("disabled");
    expect(assetsReadFailure({ disabled: false, error: "capability_required" }).kind).toBe("capability");
    expect(assetsReadFailure({ disabled: false, error: "network_error" }).kind).toBe("error");
  });
});
