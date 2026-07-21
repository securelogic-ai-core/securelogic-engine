/**
 * applicabilityReassessment.test.ts — fast, database-free unit tests for the R3
 * enqueue side (applicabilityReassessment.ts): the ECL self-gate (zero DB access
 * while dark), the dedup INSERT shape, and the payload parser the worker trusts
 * for claimed jobs. Worker end-to-end behaviour (claim → plan → assess → persist
 * → drift → dispatch) runs against real Postgres in
 * test/isolation/applicabilityReassessmentWorker.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  enqueueApplicabilityReassessment,
  parseChangeEvent,
  APPLICABILITY_REASSESS_JOB_TYPE
} from "../lib/applicabilityReassessment.js";
import type { Queryable } from "../lib/applicabilityAssessmentWriter.js";

function mockDb(returnRows: Array<Record<string, unknown>> = [{ id: "job-1" }]) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db: Queryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      return { rows: returnRows, rowCount: returnRows.length };
    }
  };
  return { db, calls };
}

const FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
let prevFlag: string | undefined;

beforeEach(() => {
  prevFlag = process.env[FLAG];
});
afterEach(() => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
});

describe("enqueueApplicabilityReassessment", () => {
  it("is a zero-DB no-op while the ECL flag is off", async () => {
    delete process.env[FLAG];
    const { db, calls } = mockDb();
    const out = await enqueueApplicabilityReassessment(db, "org-1", {
      type: "signal_changed",
      signal_id: "sig-1"
    });
    expect(out).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("INSERTs a deduped job with the event payload when the flag is on", async () => {
    process.env[FLAG] = "true";
    const { db, calls } = mockDb();
    const out = await enqueueApplicabilityReassessment(db, "org-1", {
      type: "signal_changed",
      signal_id: "sig-1"
    });
    expect(out).toBe("job-1");
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.text).toContain("INSERT INTO jobs");
    expect(c.text).toContain("NOT EXISTS");
    expect(c.text).toContain("j.status = 'queued'");
    expect(c.params[0]).toBe("org-1");
    expect(c.params[1]).toBe(APPLICABILITY_REASSESS_JOB_TYPE);
    expect(JSON.parse(String(c.params[2]))).toEqual({ event: { type: "signal_changed", signal_id: "sig-1" } });
  });

  it("returns null when the dedup NOT EXISTS suppressed the insert", async () => {
    process.env[FLAG] = "true";
    const { db } = mockDb([]);
    const out = await enqueueApplicabilityReassessment(db, "org-1", {
      type: "edge_changed",
      organization_id: "org-1",
      node_type: "vendor",
      node_id: "v-1"
    });
    expect(out).toBeNull();
  });
});

describe("parseChangeEvent", () => {
  it("round-trips all three event shapes", () => {
    const signal = { type: "signal_changed", signal_id: "sig-1" } as const;
    const edge = { type: "edge_changed", organization_id: "o-1", node_type: "vendor", node_id: "v-1" } as const;
    const entity = { type: "entity_changed", organization_id: "o-1", node_type: "enterprise_entity", node_id: "e-1" } as const;
    for (const ev of [signal, edge, entity]) {
      expect(parseChangeEvent({ event: ev })).toEqual(ev);
    }
  });

  it("rejects malformed payloads", () => {
    expect(parseChangeEvent(null)).toBeNull();
    expect(parseChangeEvent({})).toBeNull();
    expect(parseChangeEvent({ event: null })).toBeNull();
    expect(parseChangeEvent({ event: { type: "signal_changed" } })).toBeNull();
    expect(parseChangeEvent({ event: { type: "signal_changed", signal_id: "" } })).toBeNull();
    expect(parseChangeEvent({ event: { type: "edge_changed", node_type: "vendor", node_id: "v-1" } })).toBeNull();
    expect(parseChangeEvent({ event: { type: "unknown_event", signal_id: "x" } })).toBeNull();
  });
});
