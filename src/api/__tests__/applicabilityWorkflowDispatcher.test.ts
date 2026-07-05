/**
 * applicabilityWorkflowDispatcher.test.ts — fast, database-free unit tests for the
 * R2 (Slice 6) live dispatcher, using a recording mock Queryable. Proves: the flag
 * predicate; the decision→writes mapping (suggestion upsert with assessment_id,
 * finding_draft → findings, three action markers, notification → alert items);
 * the idempotency skip paths (ON CONFLICT rowCount 0 → skipped counts + existing
 * finding id backfill); AD-9 (no risk write of any kind); and that non-actionable
 * decisions produce zero writes. Real-Postgres behaviour (RLS, partial unique
 * indexes, re-dispatch no-op) is covered by
 * test/isolation/applicabilityWorkflowDispatcher.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  applicabilityWorkflowEnabled,
  dispatchApplicabilityWorkflow,
  priorityToFindingSeverity,
  targetTypeToDomain,
  APPLICABILITY_RISK_REVIEW_ACTION_TYPE,
  APPLICABILITY_EVIDENCE_ACTION_TYPE,
  APPLICABILITY_HUMAN_REVIEW_ACTION_TYPE,
  APPLICABILITY_SOURCE_TYPE
} from "../lib/applicabilityWorkflowDispatcher.js";
import { deriveWorkflowRecommendations } from "../../engine/applicability/v1/workflowRecommendations.js";
import type { StoredAssessment } from "../../engine/applicability/v1/explainability.js";
import type { Queryable } from "../lib/applicabilityAssessmentWriter.js";

function makeStored(overrides: Partial<StoredAssessment> = {}): StoredAssessment {
  return {
    organization_id: "org-1",
    signal_id: "sig-1",
    target_type: "vendor",
    target_id: "v-1",
    decision: "affected",
    confidence: 92,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: "x", outcome: "affected" }],
    affected_entities: [
      { node_type: "application", node_id: "app-1", min_depth: 1, via_target_type: "vendor", via_target_id: "v-1" },
      { node_type: "identity", node_id: "user-9", min_depth: 2, via_target_type: "vendor", via_target_id: "v-1" }
    ],
    evidence: [],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1",
    content_hash: "hash-1",
    prev_hash: "hash-0",
    ...overrides
  };
}

/**
 * Recording mock. `conflict` scripts the idempotency-skip path: when true, the
 * finding/action INSERTs return zero rows (ON CONFLICT DO NOTHING fired) and the
 * follow-up finding SELECT returns the pre-existing row.
 */
function mockDb(opts: { conflict?: boolean; suggestionInserted?: boolean } = {}) {
  const conflict = opts.conflict === true;
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db: Queryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (/INSERT INTO signal_match_suggestions/.test(text)) {
        return { rows: [{ id: "sugg-1", inserted: opts.suggestionInserted !== false }], rowCount: 1 };
      }
      if (/INSERT INTO findings/.test(text)) {
        return conflict ? { rows: [], rowCount: 0 } : { rows: [{ id: "finding-1" }], rowCount: 1 };
      }
      if (/SELECT id FROM findings/.test(text)) {
        return { rows: [{ id: "finding-existing" }], rowCount: 1 };
      }
      if (/INSERT INTO actions/.test(text)) {
        return conflict ? { rows: [], rowCount: 0 } : { rows: [{ id: `action-${calls.length}` }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  return { db, calls };
}

describe("applicabilityWorkflowEnabled", () => {
  it("is OFF by default and ON only for the exact string 'true'", () => {
    expect(applicabilityWorkflowEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(applicabilityWorkflowEnabled({ SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(applicabilityWorkflowEnabled({ SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(applicabilityWorkflowEnabled({ SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("mapping helpers", () => {
  it("maps recommendation priority to finding severity, never Critical", () => {
    expect(priorityToFindingSeverity("high")).toBe("High");
    expect(priorityToFindingSeverity("medium")).toBe("Moderate");
    expect(priorityToFindingSeverity("low")).toBe("Low");
  });

  it("maps target types to the platform domain vocabulary", () => {
    expect(targetTypeToDomain("vendor")).toBe("Vendor Risk");
    expect(targetTypeToDomain("ai_system")).toBe("AI Governance");
    expect(targetTypeToDomain("obligation")).toBe("Regulatory");
    expect(targetTypeToDomain("control")).toBe("General");
  });
});

describe("dispatchApplicabilityWorkflow — affected decision", () => {
  it("writes suggestion (with assessment_id) + finding + 2 actions and returns one alert item", async () => {
    const { db, calls } = mockDb();
    const stored = makeStored();
    const out = await dispatchApplicabilityWorkflow(db, { assessmentId: "assess-1", stored });

    // Suggestion upsert carries the assessment id and the engine reason.
    const sugg = calls.find((c) => /INSERT INTO signal_match_suggestions/.test(c.text));
    expect(sugg).toBeDefined();
    expect(sugg!.text).toContain("ON CONFLICT");
    expect(sugg!.text).toContain("DO UPDATE");
    expect(sugg!.params).toContain("assess-1");
    expect(sugg!.params).toContain("applicability_engine");
    expect(out.suggestion).toEqual({ outcome: "written", id: "sugg-1" });

    // finding_draft → findings, ON CONFLICT-guarded, source = the assessment.
    const finding = calls.find((c) => /INSERT INTO findings/.test(c.text));
    expect(finding).toBeDefined();
    expect(finding!.text).toContain("ON CONFLICT");
    expect(finding!.params).toContain(APPLICABILITY_SOURCE_TYPE);
    expect(finding!.params).toContain("assess-1");
    expect(finding!.params).toContain("High");
    expect(finding!.params).toContain("Vendor Risk");
    expect(out.finding).toEqual({ id: "finding-1", created: true });

    // affected → risk_review + evidence_request actions (human_review only for
    // potentially_affected / needs_review).
    const actionCalls = calls.filter((c) => /INSERT INTO actions/.test(c.text));
    expect(actionCalls).toHaveLength(2);
    const actionTypes = actionCalls.map((c) => c.params[3]);
    expect(actionTypes).toContain(APPLICABILITY_RISK_REVIEW_ACTION_TYPE);
    expect(actionTypes).toContain(APPLICABILITY_EVIDENCE_ACTION_TYPE);
    for (const c of actionCalls) {
      expect(c.text).toContain(`WHERE action_type = '${String(c.params[3])}'`);
      expect(c.params).toContain(APPLICABILITY_SOURCE_TYPE);
      expect(c.params).toContain("assess-1");
    }
    expect(out.actionsCreated).toHaveLength(2);
    expect(out.actionsSkipped).toBe(0);

    // One identity in the blast radius → one notification rec → ONE alert item
    // anchored to the finding (org-level recipient selection coalesces identities).
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0]).toEqual({
      findingId: "finding-1",
      title: expect.stringContaining("Applicability"),
      severity: "High",
      domain: "Vendor Risk"
    });
  });

  it("AD-9: never writes a risks row or lifecycle transition of any kind", async () => {
    const { db, calls } = mockDb();
    await dispatchApplicabilityWorkflow(db, { assessmentId: "assess-1", stored: makeStored() });
    for (const c of calls) {
      expect(c.text).not.toMatch(/INSERT INTO risks|UPDATE risks|risk_lifecycle_events/);
    }
  });

  it("coalesces multiple identity notifications into one alert item", async () => {
    const { db } = mockDb();
    const stored = makeStored({
      affected_entities: [
        { node_type: "identity", node_id: "u-1", min_depth: 1, via_target_type: "vendor", via_target_id: "v-1" },
        { node_type: "identity", node_id: "u-2", min_depth: 1, via_target_type: "vendor", via_target_id: "v-1" },
        { node_type: "identity", node_id: "u-3", min_depth: 2, via_target_type: "vendor", via_target_id: "v-1" }
      ]
    });
    // Sanity: the pure core emits one notification per identity.
    const recs = deriveWorkflowRecommendations(stored);
    expect(recs.filter((r) => r.type === "notification")).toHaveLength(3);

    const out = await dispatchApplicabilityWorkflow(db, { assessmentId: "assess-1", stored });
    expect(out.alerts).toHaveLength(1);
    expect(out.notificationsSkipped).toBe(2);
  });

  it("suppresses alert items below High priority (medium band → Moderate severity)", async () => {
    const { db } = mockDb();
    const out = await dispatchApplicabilityWorkflow(db, {
      assessmentId: "assess-1",
      stored: makeStored({ confidence: 55, confidence_band: "medium" })
    });
    expect(out.finding).not.toBeNull();
    expect(out.alerts).toHaveLength(0);
    expect(out.notificationsSkipped).toBeGreaterThan(0);
  });
});

describe("dispatchApplicabilityWorkflow — idempotent re-dispatch", () => {
  it("skips conflicted finding/action writes and backfills the existing finding id", async () => {
    const { db, calls } = mockDb({ conflict: true, suggestionInserted: false });
    const out = await dispatchApplicabilityWorkflow(db, { assessmentId: "assess-1", stored: makeStored() });

    expect(out.suggestion).toEqual({ outcome: "refreshed", id: "sugg-1" });
    expect(out.finding).toEqual({ id: "finding-existing", created: false });
    expect(out.actionsCreated).toHaveLength(0);
    expect(out.actionsSkipped).toBe(2);
    // Alert items still anchor to the pre-existing finding — the alert-send
    // ledger (per user+finding) is the at-most-once guard for emails.
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].findingId).toBe("finding-existing");
    // The existing-finding backfill SELECT ran.
    expect(calls.some((c) => /SELECT id FROM findings/.test(c.text))).toBe(true);
  });
});

describe("dispatchApplicabilityWorkflow — decision coverage", () => {
  it("potentially_affected → suggestion + human_review action + no finding, no alert", async () => {
    const { db, calls } = mockDb();
    const out = await dispatchApplicabilityWorkflow(db, {
      assessmentId: "assess-2",
      stored: makeStored({ decision: "potentially_affected", confidence: 60, confidence_band: "medium" })
    });
    expect(out.suggestion).not.toBeNull();
    expect(out.finding).toBeNull();
    const actionCalls = calls.filter((c) => /INSERT INTO actions/.test(c.text));
    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0].params[3]).toBe(APPLICABILITY_HUMAN_REVIEW_ACTION_TYPE);
    expect(out.alerts).toHaveLength(0);
  });

  it("needs_review → human_review action only", async () => {
    const { db, calls } = mockDb();
    const out = await dispatchApplicabilityWorkflow(db, {
      assessmentId: "assess-3",
      stored: makeStored({ decision: "needs_review", confidence: 0, confidence_band: "low" })
    });
    expect(out.finding).toBeNull();
    expect(out.alerts).toHaveLength(0);
    const actionCalls = calls.filter((c) => /INSERT INTO actions/.test(c.text));
    expect(actionCalls).toHaveLength(1);
    expect(out.actionsCreated).toHaveLength(1);
  });

  it("not_affected / unknown → zero DB writes", async () => {
    for (const decision of ["not_affected", "unknown"] as const) {
      const { db, calls } = mockDb();
      const out = await dispatchApplicabilityWorkflow(db, {
        assessmentId: "assess-4",
        stored: makeStored({ decision })
      });
      expect(calls).toHaveLength(0);
      expect(out.recommendations).toHaveLength(0);
      expect(out.suggestion).toBeNull();
      expect(out.finding).toBeNull();
      expect(out.alerts).toHaveLength(0);
    }
  });
});
