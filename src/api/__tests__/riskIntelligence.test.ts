import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildRiskIntelligenceList } from "../routes/risks.js";

// ====================================================================
// buildRiskIntelligenceList — empty input
// ====================================================================

describe("buildRiskIntelligenceList — empty input", () => {
  it("returns empty array for empty input", () => {
    expect(buildRiskIntelligenceList([])).toEqual([]);
  });
});

// ====================================================================
// buildRiskIntelligenceList — field mapping
// ====================================================================

describe("buildRiskIntelligenceList — field mapping", () => {
  const row = {
    id: "aaa-bbb",
    title: "SQL injection risk",
    domain: "Application Security",
    risk_rating: "Critical",
    status: "open",
    likelihood: "High",
    owner: "alice@example.com",
    active_treatments: "2",
    total_treatments: "3",
    linked_findings: "5"
  };

  it("maps id correctly", () => {
    expect(buildRiskIntelligenceList([row])[0]!.id).toBe("aaa-bbb");
  });

  it("maps title correctly", () => {
    expect(buildRiskIntelligenceList([row])[0]!.title).toBe("SQL injection risk");
  });

  it("maps domain correctly", () => {
    expect(buildRiskIntelligenceList([row])[0]!.domain).toBe("Application Security");
  });

  it("maps risk_rating correctly", () => {
    expect(buildRiskIntelligenceList([row])[0]!.risk_rating).toBe("Critical");
  });

  it("maps status correctly", () => {
    expect(buildRiskIntelligenceList([row])[0]!.status).toBe("open");
  });

  it("maps likelihood correctly when present", () => {
    expect(buildRiskIntelligenceList([row])[0]!.likelihood).toBe("High");
  });

  it("maps owner correctly when present", () => {
    expect(buildRiskIntelligenceList([row])[0]!.owner).toBe("alice@example.com");
  });
});

// ====================================================================
// buildRiskIntelligenceList — string-to-number parsing
// ====================================================================

describe("buildRiskIntelligenceList — string-to-number parsing", () => {
  const row = {
    id: "x",
    title: "t",
    domain: "d",
    risk_rating: "High",
    status: "open",
    likelihood: null,
    owner: null,
    active_treatments: "2",
    total_treatments: "4",
    linked_findings: "7"
  };

  it("parses active_treatments to number", () => {
    expect(buildRiskIntelligenceList([row])[0]!.active_treatments).toBe(2);
  });

  it("parses total_treatments to number", () => {
    expect(buildRiskIntelligenceList([row])[0]!.total_treatments).toBe(4);
  });

  it("parses linked_findings to number", () => {
    expect(buildRiskIntelligenceList([row])[0]!.linked_findings).toBe(7);
  });

  it("active_treatments is type number not string", () => {
    expect(typeof buildRiskIntelligenceList([row])[0]!.active_treatments).toBe("number");
  });

  it("total_treatments is type number not string", () => {
    expect(typeof buildRiskIntelligenceList([row])[0]!.total_treatments).toBe("number");
  });

  it("linked_findings is type number not string", () => {
    expect(typeof buildRiskIntelligenceList([row])[0]!.linked_findings).toBe("number");
  });
});

// ====================================================================
// buildRiskIntelligenceList — null fields
// ====================================================================

describe("buildRiskIntelligenceList — null fields", () => {
  const rowWithNulls = {
    id: "y",
    title: "t",
    domain: "d",
    risk_rating: "Low",
    status: "open",
    likelihood: null,
    owner: null,
    active_treatments: "0",
    total_treatments: "0",
    linked_findings: "0"
  };

  it("preserves null likelihood", () => {
    expect(buildRiskIntelligenceList([rowWithNulls])[0]!.likelihood).toBeNull();
  });

  it("preserves null owner", () => {
    expect(buildRiskIntelligenceList([rowWithNulls])[0]!.owner).toBeNull();
  });

  it("parses zero active_treatments", () => {
    expect(buildRiskIntelligenceList([rowWithNulls])[0]!.active_treatments).toBe(0);
  });

  it("parses zero total_treatments", () => {
    expect(buildRiskIntelligenceList([rowWithNulls])[0]!.total_treatments).toBe(0);
  });

  it("parses zero linked_findings", () => {
    expect(buildRiskIntelligenceList([rowWithNulls])[0]!.linked_findings).toBe(0);
  });
});

// ====================================================================
// buildRiskIntelligenceList — multiple rows
// ====================================================================

describe("buildRiskIntelligenceList — multiple rows", () => {
  const rows = [
    {
      id: "r1",
      title: "Risk A",
      domain: "Cloud",
      risk_rating: "Critical",
      status: "open",
      likelihood: "High",
      owner: "alice",
      active_treatments: "1",
      total_treatments: "2",
      linked_findings: "3"
    },
    {
      id: "r2",
      title: "Risk B",
      domain: "Network",
      risk_rating: "High",
      status: "accepted",
      likelihood: null,
      owner: null,
      active_treatments: "0",
      total_treatments: "1",
      linked_findings: "0"
    }
  ];

  it("returns correct count of rows", () => {
    expect(buildRiskIntelligenceList(rows).length).toBe(2);
  });

  it("preserves row order", () => {
    const result = buildRiskIntelligenceList(rows);
    expect(result[0]!.id).toBe("r1");
    expect(result[1]!.id).toBe("r2");
  });

  it("maps each row independently", () => {
    const result = buildRiskIntelligenceList(rows);
    expect(result[0]!.active_treatments).toBe(1);
    expect(result[1]!.active_treatments).toBe(0);
  });
});

// ====================================================================
// buildRiskIntelligenceList — output shape
// ====================================================================

describe("buildRiskIntelligenceList — output shape", () => {
  const row = {
    id: "z",
    title: "t",
    domain: "d",
    risk_rating: "Moderate",
    status: "open",
    likelihood: "Medium",
    owner: "bob",
    active_treatments: "1",
    total_treatments: "1",
    linked_findings: "2"
  };

  it("output object has exactly 10 keys", () => {
    const keys = Object.keys(buildRiskIntelligenceList([row])[0]!);
    expect(keys.sort()).toEqual(
      [
        "active_treatments",
        "domain",
        "id",
        "likelihood",
        "linked_findings",
        "owner",
        "risk_rating",
        "status",
        "title",
        "total_treatments"
      ].sort()
    );
  });
});
