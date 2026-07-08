import { describe, it, expect } from "vitest";
import {
  titleFromSnake,
  entityTypeLabel,
  nodeTypeLabel,
  relationshipTypeLabel,
  pageNav,
  readFailure,
  parseOffsetParam,
} from "../enterpriseContextFormat";
import { ENTITY_TYPES, NODE_TYPES, RELATIONSHIP_TYPES } from "../enterpriseContext";

describe("titleFromSnake", () => {
  it("title-cases snake_case", () => {
    expect(titleFromSnake("business_unit")).toBe("Business Unit");
    expect(titleFromSnake("asset")).toBe("Asset");
  });

  it("tolerates empty segments and empty input", () => {
    expect(titleFromSnake("__weird__value")).toBe("Weird Value");
    expect(titleFromSnake("")).toBe("");
  });
});

describe("entityTypeLabel", () => {
  it("labels every engine entity type", () => {
    for (const t of ENTITY_TYPES) {
      const label = entityTypeLabel(t);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_");
    }
  });

  it("gives AI-free human labels for known types", () => {
    expect(entityTypeLabel("data_store")).toBe("Data Store");
    expect(entityTypeLabel("business_service")).toBe("Business Service");
    expect(entityTypeLabel("business_process")).toBe("Business Process");
  });

  it("falls back to title-case for unknown values", () => {
    expect(entityTypeLabel("future_type")).toBe("Future Type");
  });
});

describe("nodeTypeLabel", () => {
  it("labels every graph node type, honoring the AI System casing", () => {
    for (const t of NODE_TYPES) {
      expect(nodeTypeLabel(t)).not.toContain("_");
    }
    expect(nodeTypeLabel("ai_system")).toBe("AI System");
    expect(nodeTypeLabel("enterprise_entity")).toBe("Entity");
  });
});

describe("relationshipTypeLabel", () => {
  it("renders every engine relationship type as prose", () => {
    for (const t of RELATIONSHIP_TYPES) {
      expect(relationshipTypeLabel(t)).not.toContain("_");
    }
    expect(relationshipTypeLabel("depends_on")).toBe("depends on");
    expect(relationshipTypeLabel("processes_data_in")).toBe("processes data in");
  });
});

describe("pageNav", () => {
  it("first full page: no prev, has next", () => {
    expect(pageNav(0, 25, 25)).toEqual({ prevOffset: null, nextOffset: 25 });
  });

  it("middle page: prev and next", () => {
    expect(pageNav(50, 25, 25)).toEqual({ prevOffset: 25, nextOffset: 75 });
  });

  it("short page: no next", () => {
    expect(pageNav(25, 25, 10)).toEqual({ prevOffset: 0, nextOffset: null });
  });

  it("empty first page: neither", () => {
    expect(pageNav(0, 25, 0)).toEqual({ prevOffset: null, nextOffset: null });
  });

  it("prev never goes below zero on a ragged offset", () => {
    expect(pageNav(10, 25, 25)).toEqual({ prevOffset: 0, nextOffset: 35 });
  });
});

describe("readFailure", () => {
  it("404 → disabled regardless of error code", () => {
    const f = readFailure({ disabled: true, error: "not_found" });
    expect(f.kind).toBe("disabled");
    expect(f.message.toLowerCase()).toContain("enterprise context");
  });

  it("capability_required → entitlement affordance", () => {
    const f = readFailure({ disabled: false, error: "capability_required" });
    expect(f.kind).toBe("capability");
    expect(f.message).toBe("Enterprise Context isn't enabled for your organization.");
  });

  it("other errors → generic error with shared copy, never the raw code", () => {
    const f = readFailure({ disabled: false, error: "network_error" });
    expect(f.kind).toBe("error");
    expect(f.message).toBe("Couldn't reach the server. Try again.");
    const unknown = readFailure({ disabled: false, error: "http_502" });
    expect(unknown.kind).toBe("error");
    expect(unknown.message).not.toContain("http_502");
  });
});

describe("parseOffsetParam", () => {
  it("parses a plain integer", () => {
    expect(parseOffsetParam("50")).toBe(50);
  });

  it("rejects garbage, negatives, and absence to 0", () => {
    expect(parseOffsetParam(undefined)).toBe(0);
    expect(parseOffsetParam("")).toBe(0);
    expect(parseOffsetParam("abc")).toBe(0);
    expect(parseOffsetParam("-5")).toBe(0);
  });

  it("floors fractional values", () => {
    expect(parseOffsetParam("12.9")).toBe(12);
  });
});
