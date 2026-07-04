import { describe, it, expect } from "vitest";
import {
  isFeatureDisabledStatus,
  clampLimit,
  clampOffset,
  clampDepth,
  entitiesQuery,
  relationshipsQuery,
  graphQuery,
  importQuery,
  enterpriseContextErrorMessage,
  ENTITY_PAGE,
  RELATIONSHIP_PAGE,
  GRAPH_DEPTH,
} from "../enterpriseContext";

describe("isFeatureDisabledStatus — dark-flag inference", () => {
  it("treats 404 as feature-disabled (flag off / route absent → hide)", () => {
    expect(isFeatureDisabledStatus(404)).toBe(true);
  });
  it("does NOT treat 403 as disabled (capability_required → show entitlement affordance)", () => {
    expect(isFeatureDisabledStatus(403)).toBe(false);
  });
  it("does not treat other statuses as disabled", () => {
    for (const s of [200, 400, 401, 409, 500, 502]) {
      expect(isFeatureDisabledStatus(s)).toBe(false);
    }
  });
});

describe("clampLimit", () => {
  it("undefined / non-finite → the default", () => {
    expect(clampLimit(undefined, ENTITY_PAGE)).toBe(ENTITY_PAGE.defaultLimit);
    expect(clampLimit(NaN, ENTITY_PAGE)).toBe(ENTITY_PAGE.defaultLimit);
  });
  it("caps at the max and floors at 1", () => {
    expect(clampLimit(9999, ENTITY_PAGE)).toBe(ENTITY_PAGE.maxLimit);
    expect(clampLimit(0, ENTITY_PAGE)).toBe(1);
    expect(clampLimit(-5, ENTITY_PAGE)).toBe(1);
  });
  it("passes a valid value through (floored)", () => {
    expect(clampLimit(30, ENTITY_PAGE)).toBe(30);
    expect(clampLimit(30.9, ENTITY_PAGE)).toBe(30);
  });
  it("respects the relationship bounds (max 200)", () => {
    expect(clampLimit(500, RELATIONSHIP_PAGE)).toBe(RELATIONSHIP_PAGE.maxLimit);
  });
});

describe("clampOffset", () => {
  it("undefined → 0; negatives → 0; caps at maxOffset", () => {
    expect(clampOffset(undefined, ENTITY_PAGE.maxOffset)).toBe(0);
    expect(clampOffset(-1, ENTITY_PAGE.maxOffset)).toBe(0);
    expect(clampOffset(ENTITY_PAGE.maxOffset + 1, ENTITY_PAGE.maxOffset)).toBe(ENTITY_PAGE.maxOffset);
    expect(clampOffset(50, ENTITY_PAGE.maxOffset)).toBe(50);
  });
});

describe("clampDepth — graph traversal is capped at 5 (resolver not load-tested higher)", () => {
  it("undefined → default 3", () => {
    expect(clampDepth(undefined)).toBe(GRAPH_DEPTH.default);
    expect(clampDepth(NaN)).toBe(GRAPH_DEPTH.default);
  });
  it("never exceeds the max of 5 or drops below 1", () => {
    expect(clampDepth(99)).toBe(GRAPH_DEPTH.max);
    expect(clampDepth(0)).toBe(GRAPH_DEPTH.min);
    expect(clampDepth(-3)).toBe(GRAPH_DEPTH.min);
  });
  it("passes valid depths through", () => {
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(4)).toBe(4);
    expect(clampDepth(5)).toBe(5);
  });
});

describe("entitiesQuery", () => {
  it("always sets clamped limit + offset, omits entity_type when absent", () => {
    const q = new URLSearchParams(entitiesQuery({}));
    expect(q.get("limit")).toBe(String(ENTITY_PAGE.defaultLimit));
    expect(q.get("offset")).toBe("0");
    expect(q.has("entity_type")).toBe(false);
  });
  it("includes entity_type and clamps an over-large limit", () => {
    const q = new URLSearchParams(entitiesQuery({ entity_type: "data_store", limit: 10000, offset: 5 }));
    expect(q.get("entity_type")).toBe("data_store");
    expect(q.get("limit")).toBe(String(ENTITY_PAGE.maxLimit));
    expect(q.get("offset")).toBe("5");
  });
});

describe("relationshipsQuery — node_type and node_id must travel together", () => {
  it("includes both when both present", () => {
    const q = new URLSearchParams(
      relationshipsQuery({ node_type: "enterprise_entity", node_id: "abc" }),
    );
    expect(q.get("node_type")).toBe("enterprise_entity");
    expect(q.get("node_id")).toBe("abc");
  });
  it("omits both when only one is present (engine 400s on a half filter)", () => {
    const q1 = new URLSearchParams(relationshipsQuery({ node_type: "vendor" }));
    expect(q1.has("node_type")).toBe(false);
    expect(q1.has("node_id")).toBe(false);
    const q2 = new URLSearchParams(relationshipsQuery({ node_id: "abc" }));
    expect(q2.has("node_type")).toBe(false);
    expect(q2.has("node_id")).toBe(false);
  });
  it("defaults limit to 50 (relationship bound)", () => {
    const q = new URLSearchParams(relationshipsQuery({}));
    expect(q.get("limit")).toBe(String(RELATIONSHIP_PAGE.defaultLimit));
  });
});

describe("graphQuery", () => {
  it("sets node_type, node_id, and a clamped depth", () => {
    const q = new URLSearchParams(
      graphQuery({ node_type: "enterprise_entity", node_id: "root-1", depth: 99 }),
    );
    expect(q.get("node_type")).toBe("enterprise_entity");
    expect(q.get("node_id")).toBe("root-1");
    expect(q.get("depth")).toBe(String(GRAPH_DEPTH.max));
  });
});

describe("importQuery", () => {
  it("sets entity_type and mode", () => {
    const q = new URLSearchParams(importQuery("vendor", "preview"));
    expect(q.get("entity_type")).toBe("vendor");
    expect(q.get("mode")).toBe("preview");
  });
});

describe("enterpriseContextErrorMessage", () => {
  it("maps known engine codes to human copy", () => {
    expect(enterpriseContextErrorMessage("capability_required")).toMatch(/isn't enabled/i);
    expect(enterpriseContextErrorMessage("enterprise_entity_limit_reached")).toMatch(/limit reached/i);
    expect(enterpriseContextErrorMessage("enterprise_edge_limit_reached")).toMatch(/limit reached/i);
    expect(enterpriseContextErrorMessage("self_edge_not_allowed")).toMatch(/itself/i);
    expect(enterpriseContextErrorMessage("entity_type_immutable")).toMatch(/can't be changed/i);
  });
  it("never leaks a raw unknown code — falls back to a generic message", () => {
    const msg = enterpriseContextErrorMessage("some_unmapped_code");
    expect(msg).toBe("Something went wrong. Try again.");
    expect(msg).not.toContain("some_unmapped_code");
  });
});
