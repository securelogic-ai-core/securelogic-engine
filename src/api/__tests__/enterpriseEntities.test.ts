/**
 * enterpriseEntities.test.ts — unit tests for the ECL Slice 1 pure layer:
 * the input validator and the feature-flag helper/middleware. DB-free.
 * Cross-org / RLS behavior is proven separately in
 * test/isolation/enterpriseEntitiesRls.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

import {
  validateEnterpriseEntityCreate,
  validateEnterpriseEntityUpdate
} from "../lib/enterpriseEntityValidation.js";
import {
  enterpriseContextEnabled,
  enterpriseContextFeatureFlag
} from "../lib/enterpriseContextFeatureFlag.js";

describe("validateEnterpriseEntityCreate", () => {
  it("accepts a minimal valid entity", () => {
    const r = validateEnterpriseEntityCreate({ entity_type: "asset", name: "web-01" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.entity_type).toBe("asset");
      expect(r.input.name).toBe("web-01");
      expect(r.input.status).toBe("active");
      expect(r.input.data_store).toBeNull();
    }
  });

  it("rejects a non-object body", () => {
    expect(validateEnterpriseEntityCreate(null)).toEqual({ error: "request_body_must_be_object" });
    expect(validateEnterpriseEntityCreate("x")).toEqual({ error: "request_body_must_be_object" });
  });

  it("rejects an invalid entity_type (and vendor/ai_system are not valid types)", () => {
    expect(validateEnterpriseEntityCreate({ entity_type: "vendor", name: "x" })).toMatchObject({ error: "entity_type_invalid" });
    expect(validateEnterpriseEntityCreate({ entity_type: "ai_system", name: "x" })).toMatchObject({ error: "entity_type_invalid" });
    expect(validateEnterpriseEntityCreate({ entity_type: "nope", name: "x" })).toMatchObject({ error: "entity_type_invalid" });
  });

  it("requires a non-empty name and bounds its length", () => {
    expect(validateEnterpriseEntityCreate({ entity_type: "asset", name: "   " })).toEqual({ error: "name_required" });
    expect(validateEnterpriseEntityCreate({ entity_type: "asset" })).toEqual({ error: "name_required" });
    const long = "a".repeat(201);
    expect(validateEnterpriseEntityCreate({ entity_type: "asset", name: long })).toMatchObject({ error: "name_too_long" });
  });

  it("validates optional enums (criticality/confidence/status)", () => {
    expect(validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", criticality: "CRITICAL" })).toMatchObject({ error: "criticality_invalid" });
    expect(validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", confidence: "maybe" })).toMatchObject({ error: "confidence_invalid" });
    expect(validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", status: "deleted" })).toMatchObject({ error: "status_invalid" });
    const ok = validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", criticality: "high", confidence: "medium", status: "archived" });
    expect("input" in ok).toBe(true);
  });

  it("validates owner_user_id format", () => {
    expect(validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", owner_user_id: "not-a-uuid" })).toEqual({ error: "owner_user_id_invalid" });
    const ok = validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", owner_user_id: "11111111-1111-1111-1111-111111111111" });
    expect("input" in ok).toBe(true);
  });

  it("permits a data_store child ONLY for entity_type data_store", () => {
    expect(
      validateEnterpriseEntityCreate({ entity_type: "asset", name: "x", data_store: { data_classification: "internal" } })
    ).toEqual({ error: "data_store_only_for_data_store_type" });

    const ok = validateEnterpriseEntityCreate({
      entity_type: "data_store",
      name: "pg-main",
      data_store: { data_classification: "restricted", residency_region: "eu", encryption_at_rest: true }
    });
    expect("input" in ok).toBe(true);
    if ("input" in ok) {
      expect(ok.input.data_store?.data_classification).toBe("restricted");
      expect(ok.input.data_store?.encryption_at_rest).toBe(true);
    }
  });

  it("validates data_store field types", () => {
    expect(
      validateEnterpriseEntityCreate({ entity_type: "data_store", name: "x", data_store: { data_classification: "top-secret" } })
    ).toMatchObject({ error: "data_classification_invalid" });
    expect(
      validateEnterpriseEntityCreate({ entity_type: "data_store", name: "x", data_store: { encryption_at_rest: "yes" } })
    ).toEqual({ error: "encryption_at_rest_must_be_boolean" });
  });
});

describe("validateEnterpriseEntityUpdate", () => {
  it("rejects entity_type changes (immutable)", () => {
    expect(validateEnterpriseEntityUpdate({ entity_type: "asset" })).toEqual({ error: "entity_type_immutable" });
  });

  it("accepts a partial update and returns only supplied fields", () => {
    const r = validateEnterpriseEntityUpdate({ name: "renamed", criticality: "low" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("renamed");
      expect(r.input.criticality).toBe("low");
      expect("status" in r.input).toBe(false);
    }
  });

  it("allows clearing owner_user_id with null but rejects a bad uuid", () => {
    const cleared = validateEnterpriseEntityUpdate({ owner_user_id: null });
    expect("input" in cleared && cleared.input.owner_user_id === null).toBe(true);
    expect(validateEnterpriseEntityUpdate({ owner_user_id: "bad" })).toEqual({ error: "owner_user_id_invalid" });
  });

  it("rejects an empty object body? no — empty partial is valid (no-op)", () => {
    const r = validateEnterpriseEntityUpdate({});
    expect("input" in r).toBe(true);
  });
});

describe("enterpriseContextFeatureFlag", () => {
  it("enterpriseContextEnabled is strict === 'true' and defaults off", () => {
    expect(enterpriseContextEnabled({})).toBe(false);
    expect(enterpriseContextEnabled({ SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(enterpriseContextEnabled({ SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(enterpriseContextEnabled({ SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("middleware 404s before auth when the flag is off, and calls next when on", () => {
    const prev = process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED;
    try {
      delete process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn() as unknown as NextFunction;
      enterpriseContextFeatureFlag({} as Request, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();

      process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED = "true";
      const next2 = vi.fn() as unknown as NextFunction;
      const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      enterpriseContextFeatureFlag({} as Request, res2, next2);
      expect(next2).toHaveBeenCalled();
      expect(res2.status).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED;
      else process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED = prev;
    }
  });
});
