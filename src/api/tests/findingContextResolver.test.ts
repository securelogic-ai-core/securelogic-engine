import { describe, it, expect } from "vitest";
import {
  directIntelRefs,
  describeChange,
  mergeAffected,
  resolveAssessmentAffected,
  ASSESSMENT_AFFECTED_MAP,
  affectedPathsRan,
  bucketResolution,
  type Queryable,
} from "../lib/findingContextResolver.js";

/**
 * Fake queryable: records every (sql, params) and returns canned rows for the first
 * matching SQL fragment. Lets us assert affected-entity resolution per source_type
 * and that every query is org-scoped — with no database.
 */
function fakeClient(routes: Array<{ match: RegExp; rows: any[] }>): {
  client: Queryable;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client: Queryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ sql: text, params });
      const hit = routes.find((r) => r.match.test(text));
      const rows = hit ? hit.rows : [];
      return { rows, rowCount: rows.length };
    },
  };
  return { client, calls };
}

const ORG = "11111111-1111-1111-1111-111111111111";

describe("directIntelRefs (pure)", () => {
  it("maps an intelligence_event source to eventIds", () => {
    expect(directIntelRefs("intelligence_event", "e1")).toEqual({ signalIds: [], eventIds: ["e1"] });
  });
  it("maps cyber_signal / signal sources to signalIds", () => {
    expect(directIntelRefs("cyber_signal", "s1")).toEqual({ signalIds: ["s1"], eventIds: [] });
    expect(directIntelRefs("signal", "s2")).toEqual({ signalIds: ["s2"], eventIds: [] });
  });
  it("returns empty for assessment-sourced findings or a missing source_id", () => {
    expect(directIntelRefs("vendor_review", "v1")).toEqual({ signalIds: [], eventIds: [] });
    expect(directIntelRefs("control_test", "c1")).toEqual({ signalIds: [], eventIds: [] });
    expect(directIntelRefs("cyber_signal", null)).toEqual({ signalIds: [], eventIds: [] });
  });
});

describe("describeChange (pure)", () => {
  it("labels creation", () => {
    expect(describeChange("finding.created", null)).toBe("Finding created");
  });
  it("labels field updates from the payload", () => {
    expect(describeChange("finding.updated", { severity: "Critical" })).toBe("Severity changed to Critical");
    expect(describeChange("finding.updated", { status: "in_progress" })).toBe("Status changed to in_progress");
    expect(describeChange("finding.updated", { owner_user_id: "u1" })).toBe("Owner reassigned");
    expect(describeChange("finding.updated", { priority: "immediate" })).toBe("Priority changed to immediate");
    expect(describeChange("finding.updated", {})).toBe("Finding updated");
  });
  it("humanizes unknown finding event types", () => {
    expect(describeChange("finding.escalated", null)).toBe("escalated");
  });
});

describe("mergeAffected (pure)", () => {
  it("de-duplicates by (type, id) across the two resolution paths", () => {
    const a = {
      vendors: [{ type: "vendor" as const, id: "v1", name: "Acme" }],
      ai_systems: [],
      controls: [],
      obligations: [],
    };
    const b = {
      vendors: [
        { type: "vendor" as const, id: "v1", name: "Acme" }, // dup
        { type: "vendor" as const, id: "v2", name: "DataCo" },
      ],
      ai_systems: [],
      controls: [],
      obligations: [],
    };
    expect(mergeAffected(a, b).vendors.map((x) => x.id)).toEqual(["v1", "v2"]);
  });
});

describe("resolveAssessmentAffected (assessment-family findings)", () => {
  it("covers every finding-triggering assessment source_type in the map", () => {
    // Guards against a new assessment workflow shipping without workspace context.
    for (const st of ["vendor_review", "vendor_cycle_review", "control_test", "ai_review", "ai_governance_review", "obligation_review"]) {
      expect(ASSESSMENT_AFFECTED_MAP[st]).toBeTruthy();
    }
  });

  it("resolves a vendor_review finding to its vendor and stays org-scoped", async () => {
    const { client, calls } = fakeClient([
      { match: /FROM vendor_assessments a\s+JOIN vendors e/i, rows: [{ id: "v1", name: "Acme" }] },
    ]);
    const out = await resolveAssessmentAffected(client, ORG, "vendor_review", "va1");
    expect(out.vendors).toEqual([{ type: "vendor", id: "v1", name: "Acme" }]);
    expect(out.ai_systems).toEqual([]);
    // org is the second bound param on the single query; never sourced from request input.
    expect(calls[0].params).toEqual(["va1", ORG]);
  });

  it("resolves a control_test finding to its control", async () => {
    const { client } = fakeClient([
      { match: /FROM control_assessments a\s+JOIN controls e/i, rows: [{ id: "c1", name: "MFA everywhere" }] },
    ]);
    const out = await resolveAssessmentAffected(client, ORG, "control_test", "ca1");
    expect(out.controls).toEqual([{ type: "control", id: "c1", name: "MFA everywhere" }]);
  });

  it("resolves a risk finding to its linked controls and obligations", async () => {
    const { client } = fakeClient([
      { match: /FROM risk_control_links/i, rows: [{ id: "c1", name: "Backups" }] },
      { match: /FROM risk_obligation_links/i, rows: [{ id: "o1", name: "PCI-DSS 6.2" }] },
    ]);
    const out = await resolveAssessmentAffected(client, ORG, "risk", "r1");
    expect(out.controls).toEqual([{ type: "control", id: "c1", name: "Backups" }]);
    expect(out.obligations).toEqual([{ type: "obligation", id: "o1", name: "PCI-DSS 6.2" }]);
  });

  it("resolves an applicability_assessment finding via its affected-entity targets", async () => {
    const { client } = fakeClient([
      { match: /FROM applicability_affected_entities/i, rows: [{ ttype: "vendor", tid: "v9" }] },
      { match: /FROM vendors\s+WHERE organization_id/i, rows: [{ id: "v9", name: "Ivanti" }] },
    ]);
    const out = await resolveAssessmentAffected(client, ORG, "applicability_assessment", "aa1");
    expect(out.vendors).toEqual([{ type: "vendor", id: "v9", name: "Ivanti" }]);
  });

  it("returns empty for manual findings or a missing source_id (nothing to resolve)", async () => {
    const { client, calls } = fakeClient([]);
    expect(await resolveAssessmentAffected(client, ORG, "manual", "m1")).toEqual({
      vendors: [],
      ai_systems: [],
      controls: [],
      obligations: [],
    });
    expect(await resolveAssessmentAffected(client, ORG, "vendor_review", null)).toEqual({
      vendors: [],
      ai_systems: [],
      controls: [],
      obligations: [],
    });
    // manual issues no query; null source_id short-circuits before any query.
    expect(calls.length).toBe(0);
  });
});

// ── Context Contract: per-bucket resolution status (pure) ────────────────────

describe("affectedPathsRan (Context Contract — which paths ran)", () => {
  it("manual finding with no intel refs: no path runs anywhere", () => {
    expect(affectedPathsRan("manual", false, false)).toEqual({
      vendors: false, ai_systems: false, controls: false, obligations: false,
    });
  });

  it("signal-linked finding: link path runs for all four buckets", () => {
    expect(affectedPathsRan("cyber_signal", true, false)).toEqual({
      vendors: true, ai_systems: true, controls: true, obligations: true,
    });
  });

  it("event finding with NO bridged signals: only the event-native vendor path runs", () => {
    expect(affectedPathsRan("intelligence_event", false, true)).toEqual({
      vendors: true, ai_systems: false, controls: false, obligations: false,
    });
  });

  it("assessment families run only their own bucket", () => {
    expect(affectedPathsRan("vendor_review", false, false).vendors).toBe(true);
    expect(affectedPathsRan("vendor_review", false, false).obligations).toBe(false);
    expect(affectedPathsRan("control_test", false, false).controls).toBe(true);
    expect(affectedPathsRan("ai_governance_review", false, false).ai_systems).toBe(true);
    expect(affectedPathsRan("obligation_review", false, false).obligations).toBe(true);
    expect(affectedPathsRan("dependency_review", false, false).vendors).toBe(true);
  });

  it("risk findings run controls + obligations", () => {
    const ran = affectedPathsRan("risk", false, false);
    expect(ran.controls).toBe(true);
    expect(ran.obligations).toBe(true);
    expect(ran.vendors).toBe(false);
  });

  it("applicability findings run all four (affected entities may be any type)", () => {
    expect(affectedPathsRan("applicability_assessment", true, false)).toEqual({
      vendors: true, ai_systems: true, controls: true, obligations: true,
    });
  });
});

describe("bucketResolution (empty ≠ zero ≠ unknowable)", () => {
  it("resolved when rows exist regardless of path bookkeeping", () => {
    expect(bucketResolution(true, 2)).toBe("resolved");
    expect(bucketResolution(false, 1)).toBe("resolved");
  });
  it("none_found only when a path ran and found nothing (honest zero)", () => {
    expect(bucketResolution(true, 0)).toBe("none_found");
  });
  it("not_applicable when no path could run", () => {
    expect(bucketResolution(false, 0)).toBe("not_applicable");
  });

  it("resolver_error when the path FAILED — a failure is never an honest zero", () => {
    // The state that did not exist. A bucket query that threw used to 500 the
    // context route; the client turns a non-OK response into null and silently
    // renders the legacy view, so the failure reached the user as a missing
    // feature. Now it is a value the UI can render as "we could not look".
    expect(bucketResolution(true, 0, true)).toBe("resolver_error");
    expect(bucketResolution(false, 0, true)).toBe("resolver_error");
  });

  it("a failure NEVER suppresses rows we did find — a partial answer is still an answer", () => {
    expect(bucketResolution(true, 2, true)).toBe("resolved");
  });

  it("the honest zero survives: no failure, path ran, nothing found", () => {
    expect(bucketResolution(true, 0, false)).toBe("none_found");
  });
});
