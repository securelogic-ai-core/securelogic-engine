/**
 * findingsQueueControls.test.ts — the scalable Risk Findings queue controls
 * (search / filter / sort / due-status / offset pagination) driven through the
 * REAL GET /api/findings route over real Postgres, plus the cross-org boundary.
 *
 * Proves, on a deterministic seed:
 *   - free-text search across title, description, finding id, CVE, vendor name
 *   - individual and combined filters (severity, domain, operational_status,
 *     due-status, has_action, has_evidence, created date range)
 *   - the ratified urgency default ordering + alternate sorts
 *   - offset pagination + exact total (result-count truth)
 *   - empty results
 *   - tenant isolation: org A's controls never surface org B's rows
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

// Stable ids so search-by-id is assertable.
const ID = {
  overdue: "aaaaaaaa-0000-4000-8000-000000000001",
  today: "aaaaaaaa-0000-4000-8000-000000000002",
  soon: "aaaaaaaa-0000-4000-8000-000000000003",
  none: "aaaaaaaa-0000-4000-8000-000000000004",
  future: "aaaaaaaa-0000-4000-8000-000000000005",
  closed: "aaaaaaaa-0000-4000-8000-000000000006",
  action: "aaaaaaaa-0000-4000-8000-000000000007",
  orgB: "bbbbbbbb-0000-4000-8000-000000000001",
};

async function insertFinding(
  org: string,
  opts: {
    id?: string;
    title: string;
    description?: string;
    severity: string;
    status?: string;
    operational_status?: string;
    domain?: string | null;
    dueOffsetDays?: number | null; // null → no due date
    createdOffsetDays?: number; // days before today
  }
): Promise<string> {
  const status = opts.status ?? "open";
  const op = opts.operational_status ?? "open";
  const due =
    opts.dueOffsetDays === undefined || opts.dueOffsetDays === null ? null : opts.dueOffsetDays;
  const created = opts.createdOffsetDays ?? 0;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (id, organization_id, title, description, severity, status, operational_status,
        source_type, domain, due_date, created_at)
     VALUES (
       COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, 'manual', $8,
       CASE WHEN $9::int IS NULL THEN NULL ELSE CURRENT_DATE + $9::int END,
       NOW() - make_interval(days => $10::int))
     RETURNING id`,
    [
      opts.id ?? null,
      org,
      opts.title,
      opts.description ?? "seed description",
      opts.severity,
      status,
      op,
      opts.domain ?? null,
      due,
      created,
    ]
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the findings-queue test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  const A = seed.orgA.id;
  const B = seed.orgB.id;

  // ── Org A seed: one finding per due-status, plus severity/domain spread ──
  await insertFinding(A, {
    id: ID.overdue, title: "Overdue MFA enforcement gap", severity: "High",
    domain: "Access Management", dueOffsetDays: -5, createdOffsetDays: 40,
  });
  await insertFinding(A, {
    id: ID.today, title: "Patch critical CVE today", severity: "Critical",
    domain: "Vulnerability", dueOffsetDays: 0, createdOffsetDays: 10,
  });
  await insertFinding(A, {
    id: ID.soon, title: "Vendor review due soon", severity: "Moderate",
    status: "in_progress", operational_status: "in_progress",
    domain: "Vendor Risk", dueOffsetDays: 3, createdOffsetDays: 5,
  });
  await insertFinding(A, {
    id: ID.none, title: "Policy gap without deadline", description: "no due date here",
    severity: "Low", domain: "Regulatory", dueOffsetDays: null, createdOffsetDays: 2,
  });
  await insertFinding(A, {
    id: ID.future, title: "Annual audit scheduling", severity: "High",
    domain: "Resilience", dueOffsetDays: 30, createdOffsetDays: 1,
  });
  await insertFinding(A, {
    id: ID.closed, title: "Historical closed item", severity: "Critical",
    status: "closed", operational_status: "closed", domain: "Vulnerability",
    dueOffsetDays: -100, createdOffsetDays: 200,
  });
  await insertFinding(A, {
    id: ID.action, title: "Has remediation and evidence", severity: "High",
    domain: "Access Management", dueOffsetDays: 10, createdOffsetDays: 3,
  });

  // Linked action + evidence for the has_action / has_evidence filters.
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'Fix it', 'finding', $2, 'near_term', 'open')`,
    [A, ID.action]
  );
  await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1, 'finding', $2, 'Screenshot', 'screenshot')`,
    [A, ID.none]
  );

  // CVE search path: a cyber-signal-sourced finding whose signal carries a CVE.
  const sig = await pool.query<{ id: string }>(
    `INSERT INTO cyber_signals
       (organization_id, source, signal_type, severity, normalized_summary, affected_cve, dedup_hash)
     VALUES ($1, 'nvd', 'cve', 'High', 'A vulnerability', 'CVE-2026-9999', 'qc-dedup-1')
     RETURNING id`,
    [A]
  );
  await insertFinding(A, {
    title: "Signal-sourced vulnerability", severity: "High", domain: "Vulnerability",
    dueOffsetDays: 2,
  }).then((fid) =>
    pool.query(`UPDATE findings SET source_type = 'signal', source_id = $1 WHERE id = $2`, [sig.rows[0].id, fid])
  );

  // Vendor search path: a vendor + a vendor_review finding pointing at its assessment.
  const vendor = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name, status, criticality)
     VALUES ($1, 'Globex Analytics', 'active', 'high') RETURNING id`,
    [A]
  );
  const va = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity, status)
     VALUES ($1, $2, 'security', 'Moderate', 'completed') RETURNING id`,
    [A, vendor.rows[0].id]
  );
  await insertFinding(A, {
    title: "Third party control gap", severity: "Moderate", domain: "Vendor Risk", dueOffsetDays: 4,
  }).then((fid) =>
    pool.query(`UPDATE findings SET source_type = 'vendor_review', source_id = $1 WHERE id = $2`, [va.rows[0].id, fid])
  );

  // ── Org B seed: a finding sharing org A's search term, to prove isolation ──
  await insertFinding(B, {
    id: ID.orgB, title: "Overdue MFA enforcement gap", severity: "Critical",
    domain: "Access Management", dueOffsetDays: -5, createdOffsetDays: 3,
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

/** Drive GET /api/findings with a query string; return parsed JSON body. */
async function getFindings(apiKey: string, qs: string): Promise<any> {
  const res = await request(app)
    .get(`/api/findings?${qs}`)
    .set("X-Api-Key", apiKey);
  return res;
}

describe("GET /api/findings — scalable queue controls", () => {
  const key = () => seed.orgA.apiKey;

  it("free-text search matches title", async () => {
    const res = await getFindings(key(), "q=Overdue%20MFA&limit=100");
    expect(res.status).toBe(200);
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.overdue);
    // Must NOT include org B's identically-titled finding.
    expect(ids).not.toContain(ID.orgB);
  });

  it("free-text search matches description", async () => {
    const res = await getFindings(key(), "q=no%20due%20date%20here&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.none);
  });

  it("free-text search matches the finding id", async () => {
    const res = await getFindings(key(), `q=${ID.today}&limit=100`);
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toEqual([ID.today]);
  });

  it("free-text search matches a linked CVE", async () => {
    const res = await getFindings(key(), "q=CVE-2026-9999&limit=100");
    const titles = res.body.findings.map((f: any) => f.title);
    expect(titles).toContain("Signal-sourced vulnerability");
  });

  it("free-text search matches a linked vendor name", async () => {
    const res = await getFindings(key(), "q=Globex&limit=100");
    const titles = res.body.findings.map((f: any) => f.title);
    expect(titles).toContain("Third party control gap");
  });

  it("severity filter (individual)", async () => {
    const res = await getFindings(key(), "severity=Critical&limit=100");
    const titles = res.body.findings.map((f: any) => f.title);
    expect(titles).toContain("Patch critical CVE today");
    expect(titles).toContain("Historical closed item");
    expect(res.body.findings.every((f: any) => f.severity === "Critical")).toBe(true);
  });

  it("domain + operational_status filters (combined)", async () => {
    const res = await getFindings(key(), "domain=Vendor%20Risk&operational_status=in_progress&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.soon);
    expect(res.body.findings.every((f: any) => f.operational_status === "in_progress")).toBe(true);
  });

  it("due-status filter: overdue", async () => {
    const res = await getFindings(key(), "due=overdue&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.overdue);
    expect(ids).not.toContain(ID.today);
    expect(ids).not.toContain(ID.closed); // closed is not active → not overdue
  });

  it("due-status filter: today", async () => {
    const res = await getFindings(key(), "due=today&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toEqual([ID.today]);
  });

  it("due-status filter: soon (within a week, not today)", async () => {
    const res = await getFindings(key(), "due=soon&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.soon);
    expect(ids).not.toContain(ID.today);
    expect(ids).not.toContain(ID.future);
  });

  it("due-status filter: none", async () => {
    const res = await getFindings(key(), "due=none&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.none);
    expect(ids.every((id: string) => id !== ID.overdue)).toBe(true);
  });

  it("has_action / has_evidence filters", async () => {
    const act = await getFindings(key(), "has_action=true&limit=100");
    expect(act.body.findings.map((f: any) => f.id)).toContain(ID.action);
    const ev = await getFindings(key(), "has_evidence=true&limit=100");
    expect(ev.body.findings.map((f: any) => f.id)).toContain(ID.none);
  });

  it("created date range filter", async () => {
    // Only findings created in the last 7 days (excludes the 40/200-day-old ones).
    const res = await getFindings(key(), "created_from=" + isoDaysAgo(7) + "&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).not.toContain(ID.overdue); // 40 days old
    expect(ids).not.toContain(ID.closed); // 200 days old
    expect(ids).toContain(ID.none); // 2 days old
  });

  it("default urgency ordering: overdue first, then due-soon, then by severity", async () => {
    const res = await getFindings(key(), "sort=urgency&active=true&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    const posOverdue = ids.indexOf(ID.overdue);
    const posToday = ids.indexOf(ID.today);
    const posFuture = ids.indexOf(ID.future);
    expect(posOverdue).toBe(0); // overdue is the single most urgent
    expect(posOverdue).toBeLessThan(posToday); // overdue before due-today
    expect(posToday).toBeLessThan(posFuture); // due-today before a far-future item
  });

  it("alternate sort: due_date orders nearest-first with no-due-date last", async () => {
    const res = await getFindings(key(), "sort=due_date&active=true&limit=100");
    const withDue = res.body.findings.filter((f: any) => f.due_date);
    const dueVals = withDue.map((f: any) => f.due_date);
    const sorted = [...dueVals].sort();
    expect(dueVals).toEqual(sorted);
    // The no-due-date finding sorts to the end (NULLS LAST).
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids[ids.length - 1]).toBe(ID.none);
  });

  it("alternate sort: newest vs oldest are inverses on created_at", async () => {
    const newest = (await getFindings(key(), "sort=newest&limit=100")).body.findings.map((f: any) => f.id);
    const oldest = (await getFindings(key(), "sort=oldest&limit=100")).body.findings.map((f: any) => f.id);
    expect(oldest[0]).toBe(ID.closed); // 200 days old is the oldest
    expect(newest[newest.length - 1]).toBe(ID.closed);
  });

  it("offset pagination + exact total (result-count truth)", async () => {
    const p1 = await getFindings(key(), "sort=newest&limit=3&offset=0");
    expect(p1.status).toBe(200);
    expect(p1.body.limit).toBe(3);
    expect(p1.body.offset).toBe(0);
    expect(p1.body.count).toBe(3);
    const total = p1.body.total;
    expect(total).toBeGreaterThanOrEqual(7);
    const p2 = await getFindings(key(), "sort=newest&limit=3&offset=3");
    expect(p2.body.offset).toBe(3);
    // No overlap between the two pages (stable ordering).
    const overlap = p1.body.findings
      .map((f: any) => f.id)
      .filter((id: string) => p2.body.findings.some((f: any) => f.id === id));
    expect(overlap).toEqual([]);
    // total is invariant across pages of the same filter set.
    expect(p2.body.total).toBe(total);
  });

  it("invalid sort / due / operational_status are rejected 400", async () => {
    expect((await getFindings(key(), "sort=bogus")).status).toBe(400);
    expect((await getFindings(key(), "due=whenever")).status).toBe(400);
    expect((await getFindings(key(), "operational_status=nope")).status).toBe(400);
  });

  it("empty results: a non-matching search returns count 0 / total 0", async () => {
    const res = await getFindings(key(), "q=zzz-no-such-finding-xyz&limit=100");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.total).toBe(0);
    expect(res.body.findings).toEqual([]);
  });

  it("tenant isolation: org B sees ONLY its own rows through the same controls", async () => {
    const res = await getFindings(seed.orgB.apiKey, "q=Overdue%20MFA&limit=100");
    const ids = res.body.findings.map((f: any) => f.id);
    expect(ids).toContain(ID.orgB);
    // None of org A's seeded ids leak into org B's queue.
    for (const aId of [ID.overdue, ID.today, ID.soon, ID.none, ID.future, ID.action]) {
      expect(ids).not.toContain(aId);
    }
    // And every returned row is org B's.
    expect(res.body.findings.every((f: any) => f.organization_id === seed.orgB.id)).toBe(true);
  });
});

/** ISO date N days before today (UTC), for the created_from filter. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
