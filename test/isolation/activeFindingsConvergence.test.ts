/**
 * activeFindingsConvergence.test.ts — ONE definition of an Active Finding,
 * proven across every enterprise surface against real Postgres.
 *
 * The convergence: enterprise Finding metrics used to be computed three ways —
 * `status = 'open'` (findings tiles, vendor list, entity detail pages),
 * `status IN ('open','in_progress')` (vendor risk score, gap report, schedulers),
 * and `status NOT IN ('resolved','closed','accepted')` (executive report PDF).
 * The first is the dangerous one: it counts only work NOBODY HAS STARTED, so a
 * finding left the count the moment someone began remediating it. Surfaces went
 * green because the team got busy. That is the defect this suite locks shut.
 *
 * THE definition (product ruling 2026-07-12, metricDefinitions.sqlFindingActive):
 *
 *     Active Finding = operational_status <> 'closed'
 *
 * The DB CHECK `findings_closure_axes_agree` (migration 20260906) makes this
 * identical to the legacy `status IN ('open','in_progress')`, so the client-side
 * twin (decisionQueue.isActiveStatus) selects the same population by construction.
 *
 * What this proves:
 *   1. every enterprise surface counts ACTIVE — an in_progress finding is counted;
 *   2. every tile RECONCILES with the list its link lands on;
 *   3. Active and Closed are exact complements (closed_count was `status != 'open'`,
 *      which reported in-progress work as CLOSED);
 *   4. STRICTLY OPEN survives as an explicit lifecycle filter, and is a strict
 *      SUBSET of Active — never the enterprise default;
 *   5. lifecycle: closing a finding removes it from every Active surface at once;
 *   6. tenant isolation: org B's converged aggregates see none of org A's work.
 *
 * It also prints the BEFORE/AFTER population table for this dataset (see the
 * "before/after" test), which is the evidence attached to the convergence PR.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

let vendorA = "";
let obligationA = "";
let controlA = "";
let aiSystemA = "";

/**
 * The before/after evidence, measured ONCE against the pristine seeded dataset.
 *
 * Captured in beforeAll rather than inside the reporting test because the lifecycle
 * test below deliberately CLOSES a finding. A report computed at test time would
 * silently measure whatever state the preceding tests happened to leave behind, and
 * would change meaning if the tests were reordered — evidence that depends on
 * execution order is not evidence.
 */
type BeforeAfterRow = { surface: string; before: number; after: number };
let beforeAfter: BeforeAfterRow[] = [];
let seededInProgress = 0;

const get = (path: string, key: string) => request(app).get(path).set("X-Api-Key", key);

async function insertFinding(opts: {
  orgId: string;
  title: string;
  severity: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
  domain?: string;
}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, domain,
                           source_type, source_id, status)
     VALUES ($1, $2, $3, 'convergence seed', $4, $5, $6, $7)
     RETURNING id`,
    [
      opts.orgId,
      opts.title,
      opts.severity,
      opts.domain ?? "Vendor Risk",
      opts.sourceType,
      opts.sourceId,
      opts.status,
    ]
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the convergence test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // ── Entities, one of each kind that owns a findings surface ──────────────
  const v = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name, criticality, status)
     VALUES ($1, 'conv-vendor', 'critical', 'active') RETURNING id`,
    [seed.orgA.id]
  );
  vendorA = v.rows[0]!.id;
  const va = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity)
     VALUES ($1, $2, 'security', 'High') RETURNING id`,
    [seed.orgA.id, vendorA]
  );

  const o = await pool.query<{ id: string }>(
    `INSERT INTO obligations (organization_id, title, description, source_regulation,
                              jurisdiction, domain, status, priority)
     VALUES ($1, 'conv-obligation', 'seed', 'HIPAA', 'US', 'Regulatory', 'active', 'planned')
     RETURNING id`,
    [seed.orgA.id]
  );
  obligationA = o.rows[0]!.id;
  const oa = await pool.query<{ id: string }>(
    `INSERT INTO obligation_assessments (organization_id, obligation_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [seed.orgA.id, obligationA]
  );

  const c = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name, description, domain, status)
     VALUES ($1, 'conv-control', 'seed', 'Cyber', 'active') RETURNING id`,
    [seed.orgA.id]
  );
  controlA = c.rows[0]!.id;
  const ca = await pool.query<{ id: string }>(
    `INSERT INTO control_assessments (organization_id, control_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [seed.orgA.id, controlA]
  );

  const ai = await pool.query<{ id: string }>(
    `INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'conv-ai-system') RETURNING id`,
    [seed.orgA.id]
  );
  aiSystemA = ai.rows[0]!.id;
  const aia = await pool.query<{ id: string }>(
    `INSERT INTO ai_governance_assessments (organization_id, ai_system_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [seed.orgA.id, aiSystemA]
  );

  // ── The dataset. Deliberately shaped so the OLD and NEW predicates DISAGREE:
  // every entity carries at least one in_progress finding. Under the old
  // strictly-open metric each entity under-reported by exactly that much.
  //
  // Per entity: 1 open + 1 in_progress + 1 closed  → Active 2, StrictlyOpen 1.
  const entities: Array<[string, string, string]> = [
    ["vendor_review", va.rows[0]!.id, "vnd"],
    ["obligation_review", oa.rows[0]!.id, "obl"],
    ["control_test", ca.rows[0]!.id, "ctl"],
    ["ai_governance_review", aia.rows[0]!.id, "ai"],
  ];
  for (const [sourceType, sourceId, tag] of entities) {
    await insertFinding({
      orgId: seed.orgA.id, title: `${tag} open`, severity: "Critical",
      status: "open", sourceType, sourceId,
    });
    await insertFinding({
      orgId: seed.orgA.id, title: `${tag} in_progress`, severity: "High",
      status: "in_progress", sourceType, sourceId,
    });
    await insertFinding({
      orgId: seed.orgA.id, title: `${tag} closed`, severity: "Low",
      status: "closed", sourceType, sourceId,
    });
  }

  // Two unlinked org-level findings, so the org-wide tiles have a population that
  // is larger than any single entity's: 1 in_progress (Moderate), 1 accepted.
  await insertFinding({
    orgId: seed.orgA.id, title: "org in_progress moderate", severity: "Moderate",
    status: "in_progress", sourceType: "manual", sourceId: null,
  });
  await insertFinding({
    orgId: seed.orgA.id, title: "org accepted", severity: "Low",
    status: "accepted", sourceType: "manual", sourceId: null,
  });
  // A CLOSED Critical. Exists specifically to exercise the weekly-summary/daily-digest
  // defect: those queries counted `severity='Critical'` with NO status filter at all, so
  // a Critical finding kept inflating the emailed count forever after it was remediated.
  // Without this row the digest column would read "no change" and prove nothing.
  await insertFinding({
    orgId: seed.orgA.id, title: "org closed critical", severity: "Critical",
    status: "closed", sourceType: "manual", sourceId: null,
  });

  // Org B: must never appear in org A's converged aggregates.
  await insertFinding({
    orgId: seed.orgB.id, title: "org B in_progress", severity: "Critical",
    status: "in_progress", sourceType: "manual", sourceId: null,
  });

  // ── Snapshot the before/after evidence against the pristine dataset ───────
  const count = async (predicate: string): Promise<number> => {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings WHERE organization_id = $1 AND ${predicate}`,
      [seed.orgA.id]
    );
    return Number(r.rows[0]!.n);
  };
  const ACTIVE = `operational_status <> 'closed'`;
  const OPEN = `status = 'open'`;

  seededInProgress = await count(`status = 'in_progress'`);
  beforeAfter = [
    { surface: "Findings tile — total",        before: await count(OPEN),                              after: await count(ACTIVE) },
    { surface: "Findings tile — Critical",     before: await count(`${OPEN} AND severity='Critical'`), after: await count(`${ACTIVE} AND severity='Critical'`) },
    { surface: "Findings tile — High",         before: await count(`${OPEN} AND severity='High'`),     after: await count(`${ACTIVE} AND severity='High'`) },
    { surface: "Findings tile — Moderate",     before: await count(`${OPEN} AND severity='Moderate'`), after: await count(`${ACTIVE} AND severity='Moderate'`) },
    { surface: "Findings tile — Low",          before: await count(`${OPEN} AND severity='Low'`),      after: await count(`${ACTIVE} AND severity='Low'`) },
    { surface: "Findings tile — closed_count", before: await count(`status <> 'open'`),                after: await count(`operational_status = 'closed'`) },
    // Vendor list / risk board: the count that drives the red and orange borders.
    { surface: "Vendor risk board — findings", before: await count(`${OPEN} AND source_type='vendor_review'`),        after: await count(`${ACTIVE} AND source_type='vendor_review'`) },
    { surface: "Obligation detail",            before: await count(`${OPEN} AND source_type='obligation_review'`),    after: await count(`${ACTIVE} AND source_type='obligation_review'`) },
    { surface: "Control detail",               before: await count(`${OPEN} AND source_type='control_test'`),         after: await count(`${ACTIVE} AND source_type='control_test'`) },
    { surface: "AI-system detail",             before: await count(`${OPEN} AND source_type='ai_governance_review'`), after: await count(`${ACTIVE} AND source_type='ai_governance_review'`) },
    // Weekly summary + daily digest: severity-only, NO status filter at all.
    { surface: "Weekly digest — Critical",     before: await count(`severity='Critical'`),             after: await count(`${ACTIVE} AND severity='Critical'`) },
  ];
}, 300_000);

afterAll(async () => {
  await pool?.end();
});

/*
 * Org A ledger — 15 findings (4 entities × 3, plus 3 org-level):
 *
 *   open         4   Critical ×4                (one per entity)
 *   in_progress  5   High ×4, Moderate ×1       (one per entity + one org-level)
 *   closed       5   Low ×4 (one per entity) + Critical ×1 (org-level)
 *   accepted     1   Low ×1                     (org-level)
 *
 *   ACTIVE        = open + in_progress            = 9
 *   STRICTLY OPEN = status 'open'                 = 4
 *   CLOSED        = closed + accepted (bridge)    = 6
 *   ACTIVE + CLOSED = 15 = the whole table — the two are exact complements.
 *
 * The old strictly-open metric printed 4 where the truth is 9. Every High and
 * Moderate finding in this org was in remediation, so the severity tiles read
 * zero for both — the board saw a clean High row while four High findings were
 * actively being worked.
 */

describe("Active Findings convergence — the enterprise population", () => {
  it("the org-wide severity tiles count ACTIVE, not strictly-open", async () => {
    const res = await get("/api/findings/summary", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    const s = res.body.summary;

    // 4 open (Critical) + 5 in_progress (4 High + 1 Moderate) = 9 Active.
    expect(s.active_total).toBe(9);
    expect(s.critical_active).toBe(4);
    expect(s.high_active).toBe(4);
    expect(s.medium_active).toBe(1);
    expect(s.low_active).toBe(0); // every Low is closed or accepted

    // The strictly-open twins are a STRICT SUBSET — this is the population the
    // tiles used to print, and it under-reports High by 4 and Moderate by 1.
    expect(s.open_count).toBe(4);
    expect(s.critical_open).toBe(4);
    expect(s.high_open).toBe(0);
    expect(s.medium_open).toBe(0);

    // The regression this convergence fixes, stated as an inequality:
    expect(s.high_active).toBeGreaterThan(s.high_open);
    expect(s.active_total).toBeGreaterThan(s.open_count);
  });

  it("Active and Closed are exact complements — in-progress work is NOT closed", async () => {
    const res = await get("/api/findings/summary", seed.orgA.apiKey);
    const s = res.body.summary;

    const total = (
      await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM findings WHERE organization_id = $1`,
        [seed.orgA.id]
      )
    ).rows[0]!.n;

    // closed_count was `status != 'open'`, which swept every in_progress finding
    // into "closed". If that regressed, closed_count would be 8, not 5, and this
    // sum would overshoot the table.
    expect(s.active_total + s.closed_count).toBe(Number(total));
    expect(s.closed_count).toBe(6); // 5 closed + 1 accepted (legacy compat bridge)
  });

  it("every severity tile reconciles with the list its link lands on", async () => {
    // The tile links to /findings?severity=<sev>&active=true. The destination must
    // return exactly the number the tile printed — that is what "reconcile" means.
    const sum = await get("/api/findings/summary", seed.orgA.apiKey);
    const s = sum.body.summary;

    for (const [sev, tile] of [
      ["Critical", s.critical_active],
      ["High", s.high_active],
      ["Moderate", s.medium_active],
      ["Low", s.low_active],
    ] as const) {
      const list = await get(`/api/findings?severity=${sev}&active=true`, seed.orgA.apiKey);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(tile);
    }

    const all = await get("/api/findings?active=true", seed.orgA.apiKey);
    expect(all.body.total).toBe(s.active_total);
  });

  it("STRICTLY OPEN survives as an explicit lifecycle filter, and is a subset of Active", async () => {
    // Preserved deliberately: "what has nobody started yet?" is a real operational
    // question. It is simply not the enterprise metric any more.
    const strict = await get("/api/findings?status=open", seed.orgA.apiKey);
    const active = await get("/api/findings?active=true", seed.orgA.apiKey);

    expect(strict.status).toBe(200);
    expect(strict.body.total).toBe(4);
    expect(active.body.total).toBe(9);
    expect(strict.body.total).toBeLessThan(active.body.total);

    const strictIds = new Set(strict.body.findings.map((f: { id: string }) => f.id));
    const activeIds = new Set(active.body.findings.map((f: { id: string }) => f.id));
    for (const id of strictIds) expect(activeIds.has(id)).toBe(true);
  });

  it("the vendor list serves the ACTIVE count, and it exceeds the strictly-open one", async () => {
    const res = await get("/api/vendors", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    const vendor = res.body.vendors.find((v: { id: string }) => v.id === vendorA);

    // 1 open + 1 in_progress = 2 Active; 1 strictly open. The risk board's red/orange
    // borders key off this number, so the old field made a critical vendor whose
    // findings were all in remediation render as clean.
    expect(vendor.active_findings_count).toBe(2);
    expect(vendor.open_findings_count).toBe(1);
  });

  it("obligation / control / AI-system detail all serve active_total > open_total", async () => {
    for (const path of [
      `/api/obligations/${obligationA}/findings`,
      `/api/controls/${controlA}/findings`,
      `/api/ai-systems/${aiSystemA}/findings`,
    ]) {
      const res = await get(path, seed.orgA.apiKey);
      expect(res.status).toBe(200);
      // Each entity: 1 open + 1 in_progress + 1 closed.
      expect(res.body.active_total).toBe(2);
      expect(res.body.open_total).toBe(1);
      expect(res.body.total).toBe(3);
      // The count is over the WHOLE matched set, never the page length.
      expect(res.body.active_total).toBeGreaterThan(res.body.open_total);
    }
  });

  it("lifecycle: closing a finding removes it from EVERY Active surface at once", async () => {
    const before = await get("/api/findings/summary", seed.orgA.apiKey);
    const beforeActive = before.body.summary.active_total;
    const beforeVendor = (await get("/api/vendors", seed.orgA.apiKey)).body.vendors.find(
      (v: { id: string }) => v.id === vendorA
    ).active_findings_count;

    // Close the vendor's in_progress finding through the API — the real path.
    const list = await get(`/api/vendors/${vendorA}/findings`, seed.orgA.apiKey);
    const target = list.body.findings.find((f: { status: string }) => f.status === "in_progress");
    expect(target).toBeTruthy();

    const patch = await request(app)
      .patch(`/api/findings/${target.id}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });
    expect(patch.status).toBe(200);

    const after = await get("/api/findings/summary", seed.orgA.apiKey);
    const afterVendor = (await get("/api/vendors", seed.orgA.apiKey)).body.vendors.find(
      (v: { id: string }) => v.id === vendorA
    ).active_findings_count;

    // It left Active, it entered Closed, and both axes moved together — the compat
    // bridge and the CHECK guarantee a legacy close cannot leave a stale Active row.
    expect(after.body.summary.active_total).toBe(beforeActive - 1);
    expect(after.body.summary.closed_count).toBe(before.body.summary.closed_count + 1);
    expect(afterVendor).toBe(beforeVendor - 1);

    // And the entity detail route agrees, in the same breath.
    const vf = await get(`/api/vendors/${vendorA}/findings`, seed.orgA.apiKey);
    const stillActive = vf.body.findings.filter(
      (f: { status: string }) => f.status === "open" || f.status === "in_progress"
    );
    expect(stillActive).toHaveLength(1);
  });

  it("the POSTURE SCORE is computed over Active — remediation in flight still scores", async () => {
    // The score used to be computed from `status = 'open'`, so it IMPROVED the moment a
    // team started remediating, before anything was actually fixed. Worse, /posture
    // rendered that score directly beside severity tiles built on the ACTIVE population:
    // one page, two definitions of "finding".
    //
    // Org B is the clean probe for this. It has exactly ONE finding — in_progress — and
    // NO vendors, so nothing else can contribute a signal. Under the old predicate the
    // posture engine saw ZERO findings and returned a NULL score: an org actively
    // remediating a Critical finding was told it had no posture to speak of.
    //
    // (This asserts on org B rather than org A deliberately: org A owns a vendor, and
    // postureSnapshot also synthesizes signals from vendor criticality — so org A's
    // openFindingCount is findings PLUS inventory signals, and would not isolate the
    // predicate under test.)
    const snap = await request(app)
      .post("/api/posture/snapshot")
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({});
    expect(snap.status).toBe(201);

    const sum = await get("/api/findings/summary", seed.orgB.apiKey);
    expect(sum.body.summary.active_total).toBe(1);
    expect(sum.body.summary.open_count).toBe(0); // nothing strictly open — it is in_progress

    // The in-progress finding is counted, and the org therefore HAS a score.
    expect(snap.body.openFindingCount).toBe(1);
    expect(snap.body.overallScore).not.toBeNull();
  });

  it("tenant isolation: org B's converged aggregates see none of org A's work", async () => {
    const [sumB, vendorsB, listB] = await Promise.all([
      get("/api/findings/summary", seed.orgB.apiKey),
      get("/api/vendors", seed.orgB.apiKey),
      get("/api/findings?active=true", seed.orgB.apiKey),
    ]);

    // Org B has exactly ONE finding of its own (in_progress) — which is itself the
    // point: under the old strictly-open metric org B's tile would have read 0, so a
    // cross-tenant leak into a zero would have been invisible. Now the number is real.
    expect(sumB.body.summary.active_total).toBe(1);
    expect(sumB.body.summary.high_active).toBe(0);
    expect(sumB.body.summary.critical_active).toBe(1);
    expect(sumB.body.summary.open_count).toBe(0);
    expect(listB.body.total).toBe(1);
    expect(vendorsB.body.vendors).toHaveLength(0);
  });
});

describe("Active Findings convergence — before/after population report", () => {
  it("reports the actual OLD-vs-NEW counts for every converged surface", () => {
    // eslint-disable-next-line no-console
    console.log(
      "\nBEFORE/AFTER — org A, 15 seeded findings (4 open, 5 in_progress, 5 closed, 1 accepted)\n" +
        beforeAfter
          .map((r) => {
            const delta = r.after - r.before;
            return `  ${r.surface.padEnd(30)} ${String(r.before).padStart(3)} → ${String(r.after).padStart(3)}   ${
              delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta}`
            }`;
          })
          .join("\n") +
        "\n"
    );

    // ── The invariant behind every ACTIVE-population row ────────────────────
    // Converging a strictly-open metric to Active can only ADD the work that was
    // already underway. Nothing disappears from a count a customer was watching.
    // The two exceptions below are DEFECT FIXES, and both shrink on purpose.
    const defectFixes = ["closed_count", "Weekly digest"];
    for (const r of beforeAfter) {
      if (defectFixes.some((d) => r.surface.includes(d))) continue;
      expect(r.after).toBeGreaterThanOrEqual(r.before);
    }

    // The org-wide total gains exactly the in_progress population — the measured
    // delta, not an estimate.
    const total = beforeAfter.find((r) => r.surface === "Findings tile — total")!;
    expect(total.after - total.before).toBe(seededInProgress);

    // DEFECT FIX 1 — closed_count falls by exactly the in_progress population.
    // `status != 'open'` was reporting work in flight to customers as CLOSED.
    const closed = beforeAfter.find((r) => r.surface.includes("closed_count"))!;
    expect(closed.before - closed.after).toBe(seededInProgress);

    // DEFECT FIX 2 — the weekly summary / daily digest Critical count falls by the
    // number of CLOSED Criticals (1 here). It had no status filter at all, so a
    // remediated Critical finding inflated the emailed number forever.
    const digest = beforeAfter.find((r) => r.surface.includes("Weekly digest"))!;
    expect(digest.before).toBe(5); // 4 active Critical + 1 closed Critical
    expect(digest.after).toBe(4); // only the active ones
    expect(digest.after).toBeLessThan(digest.before);

    // Every entity surface gains its own in_progress finding (one seeded per entity).
    for (const s of ["Vendor risk board", "Obligation detail", "Control detail", "AI-system detail"]) {
      const row = beforeAfter.find((r) => r.surface.startsWith(s))!;
      expect(row.before).toBe(1);
      expect(row.after).toBe(2);
    }
  });
});
