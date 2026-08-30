/**
 * vendorAssuranceOpinionAcceptance.test.ts — VA-S4-P2 (wiring-plan step 4b).
 *
 * Handler-level behavioural tests for the governed auditor-opinion acceptance
 * surface, with mocked pg and mocked audit log. The middleware chain is
 * verified in its own files; what is asserted HERE is everything that makes the
 * acceptance governed rather than merely possible:
 *
 *   - an unattributed caller is refused with a clean 403, not a 500 from the
 *     20261066 authority CHECK
 *   - a cross-org document is 404, and the org id is never taken from the body
 *   - only an APPROVED document with an ATTRIBUTED approver can carry an opinion
 *   - the value is the human's, but departing from the deterministic candidate
 *     requires a stated reason
 *   - the basis is snapshotted BY VALUE and records agreement vs override
 *   - re-decision is explicit (409), never a silent overwrite
 *   - the UPDATE re-asserts every precondition, so a lost race is a 409
 *   - accepting an opinion establishes NO coverage, touches no scope, schedules
 *     no recompute, creates no finding
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pgQuerySpy } = vi.hoisted(() => ({ pgQuerySpy: vi.fn() }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQuerySpy, connect: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn()
}));

vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));

import {
  getVendorAssuranceOpinion,
  acceptVendorAssuranceOpinion
} from "../routes/vendorAssuranceDocuments.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXTRACTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APPROVER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_USER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * The exact string every staging extraction carries. It contains BOTH
 * "Unqualified opinion" and "except for" — the case the normalizer exists to
 * get right, and the reason a LIKE test could never be the gate.
 */
const STAGING_OPINION_TEXT =
  "Unqualified opinion, except for the specific deviations and exception described in Section IV";

function buildReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationContext: { organizationId: ORG_A },
    apiKey: { id: "k1" },
    userId: USER_ID,
    ip: "127.0.0.1",
    body: {},
    params: { id: DOC_ID },
    query: {},
    ...overrides
  };
}

function buildRes(): {
  res: Record<string, unknown>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({ json, send });
  const res = { status, json, send, setHeader: vi.fn(), headersSent: false };
  return { res, status, json };
}

function docRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DOC_ID,
    processing_status: "approved",
    approved_at: "2026-08-30T10:00:00Z",
    approved_by_user_id: APPROVER_ID,
    assurance_opinion: null,
    assurance_opinion_note: null,
    assurance_opinion_reviewer_note: null,
    assurance_opinion_basis: null,
    assurance_opinion_accepted_by_user_id: null,
    assurance_opinion_accepted_at: null,
    ...overrides
  };
}

/** doc lookup → no field override → extraction carrying the staging string. */
function mockReadsForApprovedDoc(doc: Record<string, unknown> = docRow()): void {
  pgQuerySpy
    .mockResolvedValueOnce({ rowCount: 1, rows: [doc] })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: EXTRACTION_ID, fields: { auditor_opinion: { value: STAGING_OPINION_TEXT } } }]
    });
}

const auditCalls = () => (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mock.calls;

beforeEach(() => {
  pgQuerySpy.mockReset();
  (writeAuditEvent as unknown as ReturnType<typeof vi.fn>).mockReset();
});

// ---------------------------------------------------------------------------
// GET — the reviewer's screen
// ---------------------------------------------------------------------------

describe("getVendorAssuranceOpinion", () => {
  it("404 when the document belongs to another org", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq();
    const { res, status, json } = buildRes();
    await getVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "vendor_assurance_document_not_found" });
  });

  it("400 on a non-uuid document id, before any query", async () => {
    const req = buildReq({ params: { id: "not-a-uuid" } });
    const { res, status } = buildRes();
    await getVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(pgQuerySpy).not.toHaveBeenCalled();
  });

  it("proposes 'qualified' for the staging string, and reports no coverage", async () => {
    mockReadsForApprovedDoc();
    const req = buildReq();
    const { res, status, json } = buildRes();
    await getVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);
    const body = json.mock.calls[0]?.[0] as Record<string, never>;
    expect(body["accepted"]).toBeNull();
    expect(body["proposal"]).toMatchObject({ candidate: "qualified", requires_human: true });
    expect(body["source"]).toMatchObject({ origin: "extraction", extraction_id: EXTRACTION_ID });
    // Nothing is accepted, so the gate reads ineligible — absence is never coverage.
    expect(body["coverage_gate"]).toBe("ineligible");
    expect(body["establishes_requirement_coverage"]).toBe(false);
    expect(body["acceptable"]).toMatchObject({
      document_approved: true,
      approval_attributed: true,
      already_accepted: false
    });
  });

  it("prefers a reviewer field override over the extraction value", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 1, rows: [docRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ override_value: "Unmodified opinion" }] });
    const req = buildReq();
    const { res, status, json } = buildRes();
    await getVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);
    const body = json.mock.calls[0]?.[0] as Record<string, never>;
    expect(body["source"]).toMatchObject({ origin: "field_override" });
    expect(body["proposal"]).toMatchObject({ candidate: "unmodified" });
    // The extraction is never read once an override exists.
    expect(pgQuerySpy).toHaveBeenCalledTimes(2);
  });

  it("reports an already-accepted opinion with its basis", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          docRow({
            assurance_opinion: "qualified",
            assurance_opinion_note: STAGING_OPINION_TEXT,
            assurance_opinion_reviewer_note: "agreed with the carve-out reading",
            assurance_opinion_basis: { basis_version: "opinion-acceptance-1.0" },
            assurance_opinion_accepted_by_user_id: USER_ID,
            assurance_opinion_accepted_at: "2026-08-30T12:00:00Z"
          })
        ]
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: EXTRACTION_ID, fields: { auditor_opinion: { value: STAGING_OPINION_TEXT } } }]
      });
    const req = buildReq();
    const { res, json } = buildRes();
    await getVendorAssuranceOpinion(req as never, res as never);
    const body = json.mock.calls[0]?.[0] as Record<string, never>;
    expect(body["accepted"]).toMatchObject({ opinion: "qualified", accepted_by_user_id: USER_ID });
    // A qualified opinion is CONDITIONAL, not eligible — it may contribute only
    // through a governed, control-specific unrelatedness finding.
    expect(body["coverage_gate"]).toBe("conditional");
    expect(body["acceptable"]).toMatchObject({ already_accepted: true });
  });
});

// ---------------------------------------------------------------------------
// POST — authorization, fail-closed
// ---------------------------------------------------------------------------

describe("acceptVendorAssuranceOpinion — authorization", () => {
  it("403 when the caller carries no authenticated user, BEFORE any query", async () => {
    const req = buildReq({ userId: null, body: { opinion: "qualified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "human_acceptor_required" });
    // The 20261066 authority CHECK would have turned this into a 500. It never
    // reaches the database.
    expect(pgQuerySpy).not.toHaveBeenCalled();
  });

  it("403 when there is no organization context", async () => {
    const req = buildReq({ organizationContext: undefined, body: { opinion: "qualified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "organization_context_missing" });
    expect(pgQuerySpy).not.toHaveBeenCalled();
  });

  it("404 for a cross-org document, and never writes", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({ body: { opinion: "qualified" } });
    const { res, status } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(404);
    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((t) => /UPDATE/.test(t))).toBe(false);
  });

  it("scopes the document read by the CONTEXT org, never a body-supplied one", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const req = buildReq({
      body: { opinion: "qualified", organization_id: "99999999-9999-4999-8999-999999999999" }
    });
    const { res } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(pgQuerySpy.mock.calls[0]?.[1]).toEqual([DOC_ID, ORG_A]);
  });
});

// ---------------------------------------------------------------------------
// POST — the document must be the version of record
// ---------------------------------------------------------------------------

describe("acceptVendorAssuranceOpinion — document state", () => {
  it("409 when the document is not approved", async () => {
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [docRow({ processing_status: "extracted", approved_at: null, approved_by_user_id: null })]
    });
    const req = buildReq({ body: { opinion: "qualified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      error: "vendor_assurance_document_not_approved",
      status: "extracted"
    });
  });

  it("409 when the approval itself is unattributed", async () => {
    // The approve route writes `approved_by_user_id = req.userId ?? null` under
    // an API-key-only guard stack, and its consistency CHECK says nothing about
    // the approver — so an approved document with a NULL approver is reachable.
    // It must not be able to carry a governed opinion.
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [docRow({ approved_by_user_id: null })]
    });
    const req = buildReq({ body: { opinion: "qualified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      error: "vendor_assurance_document_approval_unattributed"
    });
  });
});

// ---------------------------------------------------------------------------
// POST — the value is the human's, and departures are explained
// ---------------------------------------------------------------------------

describe("acceptVendorAssuranceOpinion — validation", () => {
  it("400 on a value outside the closed vocabulary", async () => {
    mockReadsForApprovedDoc();
    const req = buildReq({ body: { opinion: "clean_enough" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "invalid_assurance_opinion" });
  });

  it("400 when the human overrides the candidate with no stated reason", async () => {
    mockReadsForApprovedDoc();
    // The normalizer reads the staging string as `qualified`. Calling it
    // `unmodified` is exactly the silent failure this surface exists to prevent.
    const req = buildReq({ body: { opinion: "unmodified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "reviewer_note_required_for_override" });
    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((t) => /UPDATE/.test(t))).toBe(false);
  });

  it("allows the override WITH a stated reason, and records the disagreement", async () => {
    mockReadsForApprovedDoc();
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [docRow({ assurance_opinion: "unmodified", assurance_opinion_accepted_by_user_id: USER_ID })]
    });
    const req = buildReq({
      body: { opinion: "unmodified", reviewer_note: "Section IV deviations are in a service we do not consume" }
    });
    const { res, status } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);
    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    const updIdx = sqls.findIndex((t) => /UPDATE vendor_assurance_documents/.test(t));
    const basis = JSON.parse(String(pgQuerySpy.mock.calls[updIdx]?.[1]?.[5]));
    expect(basis.human_agreed_with_candidate).toBe(false);
    expect(basis.proposal.candidate).toBe("qualified");
    expect(basis.accepted_opinion).toBe("unmodified");
    expect(basis.reviewer_note).toMatch(/do not consume/);
  });

  it("400 on a non-boolean supersede", async () => {
    mockReadsForApprovedDoc();
    const req = buildReq({ body: { opinion: "qualified", supersede: "yes" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "supersede_must_be_boolean" });
  });
});

// ---------------------------------------------------------------------------
// POST — the happy path, and what it deliberately does not do
// ---------------------------------------------------------------------------

describe("acceptVendorAssuranceOpinion — acceptance", () => {
  it("200 accepts the candidate, snapshots the basis by value, audits", async () => {
    mockReadsForApprovedDoc();
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        docRow({
          assurance_opinion: "qualified",
          assurance_opinion_note: STAGING_OPINION_TEXT,
          assurance_opinion_accepted_by_user_id: USER_ID,
          assurance_opinion_accepted_at: "2026-08-30T12:00:00Z"
        })
      ]
    });
    const req = buildReq({ body: { opinion: "qualified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);

    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    const updIdx = sqls.findIndex((t) => /UPDATE vendor_assurance_documents/.test(t));
    expect(updIdx).toBeGreaterThan(-1);
    const params = pgQuerySpy.mock.calls[updIdx]?.[1] as unknown[];
    expect(params[0]).toBe(DOC_ID);
    expect(params[1]).toBe(ORG_A);
    expect(params[2]).toBe("qualified");
    // The report's own words, snapshotted — extractions are mutable.
    expect(params[3]).toBe(STAGING_OPINION_TEXT);
    expect(params[6]).toBe(USER_ID);
    expect(params[7]).toBeNull(); // no prior opinion

    const basis = JSON.parse(String(params[5]));
    expect(basis).toMatchObject({
      basis_version: "opinion-acceptance-1.0",
      accepted_opinion: "qualified",
      human_agreed_with_candidate: true,
      coverage_gate_at_acceptance: "conditional",
      establishes_requirement_coverage: false
    });
    expect(basis.source).toMatchObject({ origin: "extraction", extraction_id: EXTRACTION_ID });
    expect(basis.proposal).toMatchObject({ candidate: "qualified", normalizer_version: "opinion-normalizer-1.0" });
    expect(basis.document_state_at_acceptance).toMatchObject({
      processing_status: "approved",
      approved_by_user_id: APPROVER_ID
    });
    expect(basis.supersedes).toBeUndefined();

    const ev = auditCalls().find((c) => c[0]?.eventType === "vendor_assurance.opinion.accepted");
    expect(ev?.[0]).toMatchObject({ organizationId: ORG_A, actorUserId: USER_ID, resourceId: DOC_ID });
    expect(ev?.[0]?.payload).toMatchObject({
      opinion: "qualified",
      proposed_candidate: "qualified",
      human_agreed_with_candidate: true,
      establishes_requirement_coverage: false
    });

    const body = json.mock.calls[0]?.[0] as Record<string, never>;
    expect(body["establishes_requirement_coverage"]).toBe(false);
    expect(body["coverage_gate"]).toBe("conditional");
  });

  it("re-asserts every precondition in the UPDATE, so a lost race is a 409", async () => {
    mockReadsForApprovedDoc();
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // lost the race
    const req = buildReq({ body: { opinion: "qualified" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "assurance_opinion_acceptance_conflict" });

    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    const upd = sqls.find((t) => /UPDATE vendor_assurance_documents/.test(t)) ?? "";
    expect(upd).toMatch(/processing_status = 'approved'/);
    expect(upd).toMatch(/approved_by_user_id IS NOT NULL/);
    expect(upd).toMatch(/assurance_opinion IS NOT DISTINCT FROM \$8/);
    expect(upd).toMatch(/organization_id = \$2/);
    // A failed acceptance audits nothing.
    expect(auditCalls().length).toBe(0);
  });

  it("accepting an opinion establishes NO coverage: no scope, no score, no finding", async () => {
    mockReadsForApprovedDoc();
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 1, rows: [docRow({ assurance_opinion: "unmodified" })] });
    const req = buildReq({ body: { opinion: "unmodified", reviewer_note: "clean report, no carve-out" } });
    const { res, status } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);

    // Owner ruling, 2026-08-30. An `unmodified` opinion is the MOST permissive
    // value in the vocabulary; if anything were going to leak into coverage,
    // scope or scoring, it would leak here.
    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sqls).not.toMatch(/INSERT INTO findings/i);
    expect(sqls).not.toMatch(/scope_items/i);
    expect(sqls).not.toMatch(/requirements/i);
    expect(sqls).not.toMatch(/control_mappings/i);
    expect(sqls).not.toMatch(/canonical_control/i);
    expect(sqls).not.toMatch(/vendor_risk|risk_score/i);
    expect(sqls).not.toMatch(/engagement_applicability/i);
  });
});

// ---------------------------------------------------------------------------
// POST — re-decision is explicit
// ---------------------------------------------------------------------------

describe("acceptVendorAssuranceOpinion — supersede", () => {
  const accepted = docRow({
    assurance_opinion: "qualified",
    assurance_opinion_note: STAGING_OPINION_TEXT,
    assurance_opinion_reviewer_note: "carve-out applies",
    assurance_opinion_accepted_by_user_id: OTHER_USER_ID,
    assurance_opinion_accepted_at: "2026-08-30T12:00:00Z"
  });

  it("409 rather than silently overwriting an accepted opinion", async () => {
    mockReadsForApprovedDoc(accepted);
    const req = buildReq({ body: { opinion: "unmodified", reviewer_note: "on reflection it is clean" } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      error: "assurance_opinion_already_accepted",
      accepted: { opinion: "qualified", accepted_by_user_id: OTHER_USER_ID }
    });
    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((t) => /UPDATE/.test(t))).toBe(false);
  });

  it("400 when superseding with no stated reason, even if the value matches the candidate", async () => {
    mockReadsForApprovedDoc(accepted);
    const req = buildReq({ body: { opinion: "qualified", supersede: true } });
    const { res, status, json } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: "reviewer_note_required_for_supersede" });
  });

  it("supersedes explicitly: carries the prior acceptance in the basis and audits it separately", async () => {
    mockReadsForApprovedDoc(accepted);
    pgQuerySpy.mockResolvedValueOnce({
      rowCount: 1,
      rows: [docRow({ assurance_opinion: "adverse", assurance_opinion_accepted_by_user_id: USER_ID })]
    });
    const req = buildReq({
      body: { opinion: "adverse", supersede: true, reviewer_note: "Section IV is a control we depend on" }
    });
    const { res, status } = buildRes();
    await acceptVendorAssuranceOpinion(req as never, res as never);
    expect(status).toHaveBeenCalledWith(200);

    const sqls = pgQuerySpy.mock.calls.map((c) => String(c[0]));
    const updIdx = sqls.findIndex((t) => /UPDATE vendor_assurance_documents/.test(t));
    const params = pgQuerySpy.mock.calls[updIdx]?.[1] as unknown[];
    // The prior value is re-asserted in the WHERE clause, so two concurrent
    // re-decisions cannot interleave.
    expect(params[7]).toBe("qualified");

    const basis = JSON.parse(String(params[5]));
    expect(basis.supersedes).toMatchObject({
      opinion: "qualified",
      accepted_by_user_id: OTHER_USER_ID,
      reviewer_note: "carve-out applies"
    });

    const ev = auditCalls().find((c) => c[0]?.eventType === "vendor_assurance.opinion.superseded");
    expect(ev?.[0]?.payload).toMatchObject({ opinion: "adverse", superseded_opinion: "qualified" });
    // The first-acceptance event type is NOT reused for a re-decision.
    expect(auditCalls().some((c) => c[0]?.eventType === "vendor_assurance.opinion.accepted")).toBe(false);
  });
});
