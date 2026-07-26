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
  DETAIL_BACKED_TYPES,
  isDetailBackedType,
  DETAIL_TYPE_FIELDS,
  assetCreateTarget,
  assetCreateHref,
  assetTypeToEntityType,
  assetOnboardingMethods,
  assetImportSurfaces,
  assetImportOptions,
  assetEditHref,
  assetGraphNode,
  assetGraphHref,
  assetErrorMessage,
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

  it("entity-backed assets fall back to the canonical asset page when Enterprise Context is dark", () => {
    const entity = { backing_kind: "enterprise_entities", backing_id: "e1", asset_id: "r3" };
    expect(assetDetailHref(entity, { enterpriseContextEnabled: false })).toBe("/assets/r3");
    expect(assetDetailHref(entity, { enterpriseContextEnabled: true })).toBe("/enterprise-context/entities/e1");
    // Omitted flag keeps the federated link — only an explicit "dark" reroutes.
    expect(assetDetailHref(entity, {})).toBe("/enterprise-context/entities/e1");
  });

  it("the dark-Enterprise-Context fallback never affects the other backing kinds", () => {
    expect(
      assetDetailHref({ backing_kind: "vendors", backing_id: "v1", asset_id: "r1" }, { enterpriseContextEnabled: false }),
    ).toBe("/vendors/v1");
    expect(
      assetDetailHref({ backing_kind: "endpoints", backing_id: "x", asset_id: "reg-9" }, { enterpriseContextEnabled: false }),
    ).toBe("/assets/reg-9");
  });
});

describe("assetsReadFailure", () => {
  it("classifies disabled / capability / error", () => {
    expect(assetsReadFailure({ disabled: true, error: "http_404" }).kind).toBe("disabled");
    expect(assetsReadFailure({ disabled: false, error: "capability_required" }).kind).toBe("capability");
    expect(assetsReadFailure({ disabled: false, error: "network_error" }).kind).toBe("error");
  });
});

// ─── EAR management UI helpers ───────────────────────────────────────────────

describe("detail-backed types (unified-surface CRUD home)", () => {
  it("mirrors the engine's four detail-backed types", () => {
    expect([...DETAIL_BACKED_TYPES]).toEqual(["cloud_resource", "endpoint", "api", "identity_system"]);
  });

  it("isDetailBackedType accepts the four and rejects the rest", () => {
    for (const t of DETAIL_BACKED_TYPES) expect(isDetailBackedType(t)).toBe(true);
    expect(isDetailBackedType("vendor")).toBe(false);
    expect(isDetailBackedType("application")).toBe(false);
    expect(isDetailBackedType(undefined)).toBe(false);
  });

  it("every detail-backed type is a real asset type with a field spec", () => {
    for (const t of DETAIL_BACKED_TYPES) {
      expect(isAssetType(t)).toBe(true);
      expect(DETAIL_TYPE_FIELDS[t].length).toBeGreaterThan(0);
    }
  });
});

describe("DETAIL_TYPE_FIELDS mirrors the engine validator", () => {
  it("cloud_resource.provider is required and closed", () => {
    const provider = DETAIL_TYPE_FIELDS.cloud_resource.find((f) => f.field === "provider");
    expect(provider?.required).toBe(true);
    expect(provider?.options).toEqual(["aws", "azure", "gcp", "other"]);
  });

  it("only provider is required across all types (matches REQUIRED_TYPED)", () => {
    const required: string[] = [];
    for (const t of DETAIL_BACKED_TYPES)
      for (const f of DETAIL_TYPE_FIELDS[t]) if (f.required) required.push(`${t}.${f.field}`);
    expect(required).toEqual(["cloud_resource.provider"]);
  });

  it("free-text fields carry options: null; enums carry a tuple", () => {
    const region = DETAIL_TYPE_FIELDS.cloud_resource.find((f) => f.field === "region");
    expect(region?.options).toBeNull();
    const exposure = DETAIL_TYPE_FIELDS.endpoint.find((f) => f.field === "exposure");
    expect(exposure?.options).toEqual(["internal", "internet_facing", "isolated"]);
  });
});

describe("assetCreateTarget (EAR-AD-1 federation)", () => {
  it("routes the four detail-backed types to the native surface", () => {
    for (const t of DETAIL_BACKED_TYPES) {
      expect(assetCreateTarget(t)).toEqual({ kind: "native", assetType: t });
    }
  });

  it("routes vendor / ai_system to their own screens (no ECL dependency)", () => {
    expect(assetCreateTarget("vendor")).toEqual({
      kind: "external",
      assetType: "vendor",
      href: "/vendors/new",
      requiresEcl: false,
    });
    expect(assetCreateTarget("ai_system")).toEqual({
      kind: "external",
      assetType: "ai_system",
      href: "/ai-systems/new",
      requiresEcl: false,
    });
  });

  it("routes application / database / business_process / generic to Context (ECL-gated)", () => {
    for (const t of ["application", "database", "business_process", "generic"] as const) {
      expect(assetCreateTarget(t)).toEqual({
        kind: "external",
        assetType: t,
        href: "/enterprise-context/entities/new",
        requiresEcl: true,
      });
    }
  });
});

describe("assetTypeToEntityType (registry asset_type → ECL entity_type)", () => {
  it("maps the three ECL-backed asset types to their entity_type", () => {
    expect(assetTypeToEntityType("application")).toBe("application");
    expect(assetTypeToEntityType("database")).toBe("data_store");
    expect(assetTypeToEntityType("business_process")).toBe("business_process");
  });

  it("returns null for generic and for non-ECL-backed types (no preselection)", () => {
    expect(assetTypeToEntityType("generic")).toBeNull();
    for (const t of ["vendor", "ai_system", "cloud_resource", "endpoint", "api", "identity_system"] as const) {
      expect(assetTypeToEntityType(t)).toBeNull();
    }
  });
});

describe("assetCreateHref (canonical single-selection create routing)", () => {
  it("detail-backed types render the native inline form on the unified surface", () => {
    for (const t of DETAIL_BACKED_TYPES) {
      expect(assetCreateHref(t)).toBe(`/assets/new?type=${t}`);
    }
  });

  it("vendor / ai_system open their dedicated screens framed as a registry flow", () => {
    expect(assetCreateHref("vendor")).toBe("/vendors/new?from=registry");
    expect(assetCreateHref("ai_system")).toBe("/ai-systems/new?from=registry");
  });

  it("frames vendor and ai_system IDENTICALLY (both ?from=registry → shared breadcrumb back to Assets)", () => {
    for (const t of ["vendor", "ai_system"] as const) {
      expect(assetCreateHref(t).endsWith("/new?from=registry")).toBe(true);
    }
  });

  it("ECL-backed types open Add-Entity with entity_type + asset_type preselected", () => {
    expect(assetCreateHref("application")).toBe(
      "/enterprise-context/entities/new?entity_type=application&asset_type=application",
    );
    expect(assetCreateHref("database")).toBe(
      "/enterprise-context/entities/new?entity_type=data_store&asset_type=database",
    );
    expect(assetCreateHref("business_process")).toBe(
      "/enterprise-context/entities/new?entity_type=business_process&asset_type=business_process",
    );
  });

  it("generic opens Add-Entity with its full picker (explicit generic/custom creation)", () => {
    expect(assetCreateHref("generic")).toBe("/enterprise-context/entities/new");
  });
});

describe("assetImportSurfaces", () => {
  it("lists existing importers and flags the ECL-gated one", () => {
    const surfaces = assetImportSurfaces();
    expect(surfaces.map((s) => s.href)).toEqual([
      "/vendors/import",
      "/ai-systems/import",
      "/enterprise-context/import",
    ]);
    expect(surfaces.find((s) => s.href === "/enterprise-context/import")?.requiresEcl).toBe(true);
    expect(surfaces.find((s) => s.href === "/vendors/import")?.requiresEcl).toBe(false);
  });
});

describe("assetOnboardingMethods (canonical create surface exposes THREE options)", () => {
  const methods = assetOnboardingMethods();

  it("exposes exactly the three canonical methods, in order", () => {
    expect(methods.map((m) => m.key)).toEqual(["create", "import", "connect"]);
  });

  it("labels each option (create manually / bulk upload / connect)", () => {
    expect(methods.find((m) => m.key === "create")?.title).toBe("Create manually");
    expect(methods.find((m) => m.key === "import")?.title).toBe("Bulk upload");
    expect(methods.find((m) => m.key === "connect")?.title).toBe("Connect enterprise systems");
  });

  it("connect routes to the EXISTING /assets/connect flow; create/import fan out in-surface", () => {
    expect(methods.find((m) => m.key === "connect")?.href).toBe("/assets/connect");
    expect(methods.find((m) => m.key === "create")?.href).toBeNull();
    expect(methods.find((m) => m.key === "import")?.href).toBeNull();
  });

  it("bulk upload reuses the CSV/XLSX importers (no SOC, no 'coming soon')", () => {
    // Import targets are the existing per-surface importers — no new importer.
    expect(assetImportSurfaces().every((s) => s.href.endsWith("/import"))).toBe(true);
    const allCopy = methods.map((m) => `${m.title} ${m.description}`).join(" ").toLowerCase();
    expect(allCopy).toContain("csv");
    expect(allCopy).not.toContain("soc");
    expect(allCopy).not.toContain("coming soon");
  });
});

describe("assetEditHref", () => {
  it("only detail-backed assets have an edit route", () => {
    expect(assetEditHref({ asset_id: "r1", asset_type: "endpoint" })).toBe("/assets/r1/edit");
    expect(assetEditHref({ asset_id: "r2", asset_type: "vendor" })).toBeNull();
    expect(assetEditHref({ asset_id: "r3", asset_type: "application" })).toBeNull();
  });
});

describe("assetGraphNode / assetGraphHref (mirror engine graphNodeForBacking)", () => {
  it("keys the pre-registry backings by their node type + backing id", () => {
    expect(assetGraphNode({ backing_kind: "vendors", backing_id: "v1", asset_id: "r1" })).toEqual({
      node_type: "vendor",
      node_id: "v1",
    });
    expect(assetGraphNode({ backing_kind: "ai_systems", backing_id: "a1", asset_id: "r2" })).toEqual({
      node_type: "ai_system",
      node_id: "a1",
    });
    expect(assetGraphNode({ backing_kind: "enterprise_entities", backing_id: "e1", asset_id: "r3" })).toEqual({
      node_type: "enterprise_entity",
      node_id: "e1",
    });
  });

  it("keys detail-backed assets as Tier-0 'asset' nodes by registry id", () => {
    expect(assetGraphNode({ backing_kind: "cloud_resources", backing_id: "c1", asset_id: "reg-9" })).toEqual({
      node_type: "asset",
      node_id: "reg-9",
    });
  });

  it("builds a graph deep-link with encoded params", () => {
    expect(assetGraphHref({ backing_kind: "cloud_resources", backing_id: "c1", asset_id: "reg 9" })).toBe(
      "/enterprise-context/graph?node_type=asset&node_id=reg%209",
    );
  });
});

describe("assetImportOptions — EAR P16 unified importer routing", () => {
  const options = assetImportOptions();

  it("covers exactly the ten canonical asset types (no server/network_device/facility)", () => {
    expect(options.map((o) => o.assetType).sort()).toEqual([...ASSET_TYPES].sort());
  });

  it("routes the four detail-backed types to /api/assets/import (no ECL fence)", () => {
    for (const t of DETAIL_BACKED_TYPES) {
      const o = options.find((x) => x.assetType === t)!;
      expect(o.route).toEqual({ backend: "assets" });
      expect(o.requiresEcl).toBe(false);
    }
  });

  it("routes the six federated types to the ECL endpoint with the mapped entity_type", () => {
    const byType = Object.fromEntries(options.map((o) => [o.assetType, o.route]));
    expect(byType.vendor).toEqual({ backend: "ecl", entityType: "vendor" });
    expect(byType.ai_system).toEqual({ backend: "ecl", entityType: "ai_system" });
    expect(byType.application).toEqual({ backend: "ecl", entityType: "application" });
    expect(byType.database).toEqual({ backend: "ecl", entityType: "data_store" });
    expect(byType.business_process).toEqual({ backend: "ecl", entityType: "business_process" });
    expect(byType.generic).toEqual({ backend: "ecl", entityType: "asset" });
    for (const t of ["vendor", "ai_system", "application", "database", "business_process", "generic"]) {
      expect(options.find((o) => o.assetType === t)!.requiresEcl).toBe(true);
    }
  });

  it("every option lists 'name' as the first (required) column", () => {
    for (const o of options) expect(o.columns[0]).toBe("name");
  });
});

describe("assetErrorMessage", () => {
  it("maps known codes to human copy", () => {
    expect(assetErrorMessage("provider_required")).toContain("Provider");
    expect(assetErrorMessage("not_detail_backed")).toContain("own screen");
    expect(assetErrorMessage("asset_cap_exceeded")).toContain("limit");
  });

  it("handles dynamic typed-field codes and unknowns", () => {
    expect(assetErrorMessage("protocol_invalid")).toBe("One of the fields has an invalid value.");
    expect(assetErrorMessage("hostname_required")).toBe("A required field is missing.");
    expect(assetErrorMessage("totally_unknown")).toBe("Something went wrong. Try again.");
  });
});
