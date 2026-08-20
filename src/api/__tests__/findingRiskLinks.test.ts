/**
 * findingRiskLinks.test.ts — Findings ↔ Risk Register (SL-RISK-LINK).
 *
 * WHAT THIS FILE PROTECTS. The register is only worth reporting from if the
 * relationship behind it is honest. Four properties carry that, and each has a
 * failure mode that is invisible until an auditor asks:
 *
 *   STANDALONE IS THE DEFAULT. Nothing may create a link on its own. A system
 *   that quietly promoted findings would fill the register with entries no
 *   human ever accepted, and the register would stop meaning anything.
 *
 *   PROMOTION IS A HUMAN ACT with a human-supplied rating. Title and domain
 *   default from the finding because that is clerical; likelihood and impact do
 *   NOT, because a rating nobody can be named for is a rating nobody will
 *   defend.
 *
 *   MANY FINDINGS, ONE RISK. The whole reason this is a join table rather than
 *   the existing single-valued risks.source_id.
 *
 *   UNLINK REMOVES THE RELATIONSHIP AND NOTHING ELSE. Both objects survive, and
 *   the fact that they were once linked survives in the audit stream.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/* ── Simulated store ─────────────────────────────────────────────────────── */

type LinkRow = {
  id: string;
  organization_id: string;
  finding_id: string;
  risk_id: string;
  link_type: string;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FINDING_A = "11111111-1111-4111-8111-111111111111";
const FINDING_A2 = "11111111-1111-4111-8111-222222222222";
const RISK_A = "33333333-3333-4333-8333-333333333333";
const FINDING_B = "44444444-4444-4444-8444-444444444444";
const RISK_B = "55555555-5555-4555-8555-555555555555";
/**
 * The full rating a person must supply to promote. validateRiskCreate requires
 * the inherent (pre-controls) and residual (post-controls) trios as well as the
 * current one — a promoted risk is a complete register entry, not a stub, and
 * is held to exactly the rules a hand-entered risk obeys.
 */
const FULL_RATING = {
  likelihood: "likely", impact: "High", risk_rating: "High",
  inherent_likelihood: "likely", inherent_impact: "High", inherent_rating: "High",
  residual_likelihood: "possible", residual_impact: "Moderate", residual_rating: "Moderate",
};

const USER = "99999999-9999-4999-8999-999999999999";

const DB = {
  findings: [
    { id: FINDING_A, organization_id: ORG_A, title: "Unencrypted backups", domain: "cyber", severity: "High", status: "open", source_type: "manual", due_date: null },
    { id: FINDING_A2, organization_id: ORG_A, title: "Missing MFA on admin", domain: "cyber", severity: "Critical", status: "open", source_type: "control_test", due_date: null },
    { id: FINDING_B, organization_id: ORG_B, title: "Other tenant finding", domain: "cyber", severity: "Low", status: "open", source_type: "manual", due_date: null },
  ],
  risks: [
    { id: RISK_A, organization_id: ORG_A, title: "Backup exposure", domain: "cyber", risk_rating: "High", status: "open" },
    { id: RISK_B, organization_id: ORG_B, title: "Other tenant risk", domain: "cyber", risk_rating: "Low", status: "open" },
  ],
  links: [] as LinkRow[],
};

let seq = 0;

const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (/SELECT 1 FROM findings/i.test(sql)) {
    const hit = DB.findings.find((f) => f.id === params[0] && f.organization_id === params[1]);
    return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 };
  }
  if (/SELECT 1 FROM risks/i.test(sql)) {
    const hit = DB.risks.find((r) => r.id === params[0] && r.organization_id === params[1]);
    return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 };
  }
  if (/SELECT title, domain FROM findings/i.test(sql)) {
    const hit = DB.findings.find((f) => f.id === params[0] && f.organization_id === params[1]);
    return { rows: hit ? [{ title: hit.title, domain: hit.domain }] : [], rowCount: hit ? 1 : 0 };
  }
  if (/INSERT INTO finding_risks/i.test(sql)) {
    const [orgId, findingId, riskId, note, userId] = params as [string, string, string, string | null, string | null];
    const linkType = /'promoted'/.test(sql) ? "promoted" : "linked";
    const clash = DB.links.find(
      (l) => l.organization_id === orgId && l.finding_id === findingId && l.risk_id === riskId
    );
    if (clash) return { rows: [], rowCount: 0 };
    const row: LinkRow = {
      id: `link-${++seq}`, organization_id: orgId, finding_id: findingId, risk_id: riskId,
      link_type: linkType, note, created_by_user_id: userId, created_at: "2026-09-01T00:00:00.000Z",
    };
    DB.links.push(row);
    return { rows: [{ id: row.id, created_at: row.created_at }], rowCount: 1 };
  }
  if (/DELETE FROM finding_risks/i.test(sql)) {
    const [orgId, findingId, riskId] = params as [string, string, string];
    const idx = DB.links.findIndex(
      (l) => l.organization_id === orgId && l.finding_id === findingId && l.risk_id === riskId
    );
    if (idx === -1) return { rows: [], rowCount: 0 };
    const [gone] = DB.links.splice(idx, 1);
    return { rows: [{ link_type: gone!.link_type }], rowCount: 1 };
  }
  if (/FROM finding_risks fr/i.test(sql) && /JOIN risks r/i.test(sql)) {
    const [orgId, findingId] = params as [string, string];
    const rows = DB.links
      .filter((l) => l.organization_id === orgId && l.finding_id === findingId)
      .map((l) => {
        const r = DB.risks.find((x) => x.id === l.risk_id)!;
        return { risk_id: l.risk_id, link_type: l.link_type, note: l.note, created_at: l.created_at,
                 created_by_user_id: l.created_by_user_id, risk_title: r.title, risk_domain: r.domain,
                 risk_rating: r.risk_rating, risk_status: r.status };
      });
    return { rows, rowCount: rows.length };
  }
  if (/FROM finding_risks fr/i.test(sql) && /JOIN findings f/i.test(sql)) {
    const [orgId, riskId] = params as [string, string];
    const rows = DB.links
      .filter((l) => l.organization_id === orgId && l.risk_id === riskId)
      .map((l) => {
        const f = DB.findings.find((x) => x.id === l.finding_id)!;
        return { finding_id: l.finding_id, link_type: l.link_type, note: l.note, created_at: l.created_at,
                 finding_title: f.title, finding_severity: f.severity, finding_status: f.status,
                 finding_source_type: f.source_type, finding_due_date: f.due_date };
      });
    return { rows, rowCount: rows.length };
  }
  if (/INSERT INTO risks/i.test(sql)) {
    const [orgId, title, , domain, , , rating] = params as string[];
    // A real UUID: the delete route validates the id shape, so a synthetic
    // "risk-new-1" would 400 and the promotion-unlink case would pass for the
    // wrong reason.
    const id = `66666666-6666-4666-8666-${String(++seq).padStart(12, "0")}`;
    DB.risks.push({ id, organization_id: orgId!, title: title!, domain: domain!, risk_rating: rating!, status: "open" });
    return { rows: [{ id }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
});

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (sql: string, params?: unknown[]) => query(sql, params ?? []) },
  pgElevated: { query: (sql: string, params?: unknown[]) => query(sql, params ?? []) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const auditEvents: Array<Record<string, unknown>> = [];
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: (e: Record<string, unknown>) => { auditEvents.push(e); },
  writeAuditEventAwaited: async (e: Record<string, unknown>) => { auditEvents.push(e); return true; },
}));

// The guards are exercised by their own suites; here they are made transparent
// so the RELATIONSHIP logic is what is under test. Tenant scoping is asserted
// through organizationContext, which is what the handlers actually read, and
// at the database layer by test/isolation/findingRiskLinksRls.test.ts.
const CALLER = { orgId: ORG_A };
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).apiKey = { id: "77777777-7777-4777-8777-777777777777" };
    (req as unknown as Record<string, unknown>).userId = USER;
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).organizationContext = { organizationId: CALLER.orgId };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../middleware/asTenant.js", () => ({
  asTenant: (h: express.RequestHandler) => h,
}));

import router from "../routes/findingRiskLinks.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return a;
}

const eventTypes = () => auditEvents.map((e) => e.eventType);

beforeEach(() => {
  vi.clearAllMocks();
  DB.links = [];
  DB.risks = DB.risks.filter((r) => r.id === RISK_A || r.id === RISK_B);
  auditEvents.length = 0;
  CALLER.orgId = ORG_A;
  seq = 0;
});

/* ── Standalone is the default ───────────────────────────────────────────── */

describe("a finding is standalone until a person says otherwise", () => {
  it("has no links until one is created", async () => {
    const res = await request(app()).get(`/api/findings/${FINDING_A}/risk-links`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ links: [], count: 0 });
  });

  it("nothing in the read path creates a link", async () => {
    await request(app()).get(`/api/findings/${FINDING_A}/risk-links`);
    await request(app()).get(`/api/risks/${RISK_A}/findings`);

    expect(DB.links).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });
});

/* ── Link to an existing register entry ──────────────────────────────────── */

describe("linking to an existing risk", () => {
  it("creates the relationship and audits it", async () => {
    const res = await request(app())
      .post(`/api/findings/${FINDING_A}/risk-links`)
      .send({ risk_id: RISK_A, note: "Same root cause as the register entry" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ linked: true, already_linked: false });
    expect(DB.links).toHaveLength(1);
    expect(DB.links[0]).toMatchObject({ link_type: "linked", created_by_user_id: USER });
    expect(auditEvents[0]).toMatchObject({
      eventType: "finding.risk_linked",
      resourceType: "finding",
      resourceId: FINDING_A,
      organizationId: ORG_A,
    });
  });

  it("is idempotent — a second link is not a duplicate and not an error", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });
    const res = await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ linked: true, already_linked: true });
    expect(DB.links).toHaveLength(1);
    // And the second attempt does NOT emit a second audit event — a register
    // report counting two links would overstate its own evidence.
    expect(eventTypes().filter((t) => t === "finding.risk_linked")).toHaveLength(1);
  });

  it("rejects a missing risk_id rather than guessing", async () => {
    const res = await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "risk_id_required" });
  });
});

/* ── Many findings, one risk ─────────────────────────────────────────────── */

describe("multiple findings roll up to one risk", () => {
  it("accepts a second, different finding against the same risk", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });
    const res = await request(app()).post(`/api/findings/${FINDING_A2}/risk-links`).send({ risk_id: RISK_A });

    expect(res.status).toBe(201);
    expect(DB.links).toHaveLength(2);
  });

  it("the register entry lists every supporting finding", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });
    await request(app()).post(`/api/findings/${FINDING_A2}/risk-links`).send({ risk_id: RISK_A });

    const res = await request(app()).get(`/api/risks/${RISK_A}/findings`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.findings.map((f: { finding_id: string }) => f.finding_id))
      .toEqual([FINDING_A, FINDING_A2]);
    // Enough to render the panel without a second round trip.
    expect(res.body.findings[0]).toMatchObject({
      finding_title: "Unencrypted backups", finding_severity: "High", finding_source_type: "manual",
    });
  });
});

/* ── Navigation, both directions ─────────────────────────────────────────── */

describe("navigation works from either end", () => {
  it("finding → linked risks", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });

    const res = await request(app()).get(`/api/findings/${FINDING_A}/risk-links`);

    expect(res.body.count).toBe(1);
    expect(res.body.links[0]).toMatchObject({
      risk_id: RISK_A, risk_title: "Backup exposure", risk_rating: "High", link_type: "linked",
    });
  });

  it("risk → supporting findings", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });

    const res = await request(app()).get(`/api/risks/${RISK_A}/findings`);

    expect(res.body.findings[0]).toMatchObject({ finding_id: FINDING_A });
  });
});

/* ── Unlink ──────────────────────────────────────────────────────────────── */

describe("unlinking removes the relationship and nothing else", () => {
  it("deletes the link, keeps both objects, and audits what was removed", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });
    auditEvents.length = 0;

    const res = await request(app()).delete(`/api/findings/${FINDING_A}/risk-links/${RISK_A}`);

    expect(res.status).toBe(200);
    expect(DB.links).toHaveLength(0);
    expect(DB.findings.some((f) => f.id === FINDING_A)).toBe(true);
    expect(DB.risks.some((r) => r.id === RISK_A)).toBe(true);
    expect(auditEvents[0]).toMatchObject({
      eventType: "finding.risk_unlinked",
      payload: { risk_id: RISK_A, unlinked_link_type: "linked" },
    });
  });

  it("records that a PROMOTION was unlinked, which the deleted row cannot", async () => {
    const promote = await request(app())
      .post(`/api/findings/${FINDING_A}/promote-to-risk`)
      .send(FULL_RATING);
    expect(promote.status).toBe(201);
    const promotedRiskId = DB.links[0]!.risk_id;
    auditEvents.length = 0;

    await request(app()).delete(`/api/findings/${FINDING_A}/risk-links/${promotedRiskId}`);

    expect(auditEvents[0]).toMatchObject({
      eventType: "finding.risk_unlinked",
      payload: { unlinked_link_type: "promoted" },
    });
  });

  it("404s on a link that does not exist", async () => {
    const res = await request(app()).delete(`/api/findings/${FINDING_A}/risk-links/${RISK_A}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "link_not_found" });
  });
});

/* ── Promotion ───────────────────────────────────────────────────────────── */

describe("promotion creates a new register entry, by hand", () => {
  it("creates the risk, links it as 'promoted', and audits BOTH objects", async () => {
    const res = await request(app())
      .post(`/api/findings/${FINDING_A}/promote-to-risk`)
      .send(FULL_RATING);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ promoted: true, finding_id: FINDING_A });
    expect(DB.links[0]).toMatchObject({ link_type: "promoted" });

    // Two rows on purpose: the register needs "a risk was created", the finding
    // needs "this is what happened to it".
    expect(eventTypes()).toEqual(["risk.created", "finding.promoted_to_risk"]);
    expect(auditEvents[0]).toMatchObject({ resourceType: "risk", payload: { via: "finding_promotion" } });
    expect(auditEvents[1]).toMatchObject({ resourceType: "finding", resourceId: FINDING_A });
  });

  it("defaults title and domain from the finding — the clerical part", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/promote-to-risk`)
      .send(FULL_RATING);

    const created = DB.risks.find((r) => r.id === DB.links[0]!.risk_id)!;
    expect(created).toMatchObject({ title: "Unencrypted backups", domain: "cyber" });
  });

  it("REFUSES to invent a rating — likelihood and impact must come from a person", async () => {
    // A register rating nobody can be named for is a rating nobody will defend.
    const res = await request(app()).post(`/api/findings/${FINDING_A}/promote-to-risk`).send({});

    expect(res.status).toBe(400);
    expect(DB.links).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });

  it("applies the SAME validation a hand-entered risk gets", async () => {
    const res = await request(app()).post(`/api/findings/${FINDING_A}/promote-to-risk`)
      .send({ ...FULL_RATING, likelihood: "not_a_real_value" });

    expect(res.status).toBe(400);
    expect(DB.risks.filter((r) => r.id.startsWith("66666666"))).toHaveLength(0);
  });

  it("an explicit title overrides the finding's", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/promote-to-risk`)
      .send({ ...FULL_RATING, title: "Backup and recovery exposure" });

    const created = DB.risks.find((r) => r.id === DB.links[0]!.risk_id)!;
    expect(created.title).toBe("Backup and recovery exposure");
  });
});

/* ── Tenant isolation at the route layer ─────────────────────────────────── */

describe("tenant isolation — a cross-tenant id is not a relationship", () => {
  it("cannot link this org's finding to ANOTHER org's risk", async () => {
    const res = await request(app())
      .post(`/api/findings/${FINDING_A}/risk-links`)
      .send({ risk_id: RISK_B });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "risk_not_found" });
    expect(DB.links).toHaveLength(0);
  });

  it("cannot link ANOTHER org's finding to this org's risk", async () => {
    const res = await request(app())
      .post(`/api/findings/${FINDING_B}/risk-links`)
      .send({ risk_id: RISK_A });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "finding_not_found" });
    expect(DB.links).toHaveLength(0);
  });

  it("cannot promote another org's finding", async () => {
    const res = await request(app()).post(`/api/findings/${FINDING_B}/promote-to-risk`)
      .send(FULL_RATING);

    expect(res.status).toBe(404);
    expect(DB.risks.filter((r) => r.id.startsWith("66666666"))).toHaveLength(0);
  });

  it("cannot read another org's links, even knowing both ids", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });

    CALLER.orgId = ORG_B;
    const res = await request(app()).get(`/api/risks/${RISK_A}/findings`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "risk_not_found" });
  });

  it("cannot unlink another org's relationship", async () => {
    await request(app()).post(`/api/findings/${FINDING_A}/risk-links`).send({ risk_id: RISK_A });

    CALLER.orgId = ORG_B;
    const res = await request(app()).delete(`/api/findings/${FINDING_A}/risk-links/${RISK_A}`);

    expect(res.status).toBe(404);
    expect(DB.links).toHaveLength(1);
  });
});
