/**
 * r5PipelineIsolation.test.ts — closes R5 (TENANT_ISOLATION_STANDARD.md §11):
 * "intelligence worker is global; per-org fan-out occurs at brief generation.
 * Not yet verified that the fan-out path enforces org filtering on
 * signal-to-org linkage."
 *
 * WHY A REAL POSTGRES TEST (not a mock)
 * -------------------------------------
 * The matcher fan-out runs on `pgElevated` — the DB-owner pool that BYPASSES
 * RLS (src/api/infra/postgres.ts) — and is NOT wrapped in withTenant. So on
 * this path RLS is not a backstop: org isolation depends ENTIRELY on the
 * literal `WHERE organization_id = $orgId` predicates inside
 * runMatcherForSignal and on the brief-generation SELECT. A mocked `pg` cannot
 * detect a missing predicate; only a real DB with two orgs' rows can. These
 * tests therefore prove WHERE-clause discipline on the worker→brief path — they
 * do NOT assert live RLS enforcement (RLS is inert pre-flip; the *Rls.test.ts
 * siblings cover the policy layer separately).
 *
 * WHAT IS EXERCISED (zero network / LLM / Redis)
 * ----------------------------------------------
 * The already-exported matcher core `runMatcherForSignal(signal, orgId)`
 * (cyberSignalProcessingService.ts:283) opens its own pgElevated connection
 * against the harness DB, and the literal brief-generation SELECT
 * (briefScheduler.ts:255-260) replicated below. The private fan-out wrappers
 * (fanOutMatcherToActiveOrgs / fanOutKevMatcher / generateAndStoreBrief) pull
 * live feeds + LLM and are NOT invoked (scope (a): zero application-code
 * change); the wrappers are thin enumerate-and-call shims over this core. We
 * drive the core per-org ourselves, exactly as the fan-out does.
 *
 * The match key is the canonical VENDOR NAME (case-insensitive); affected_cve
 * only affects the finding title, not matching. "Microsoft" exists for both
 * orgs (matches both); "Acme" exists only for org A (matches A, no_match for B).
 *
 * DETERMINISM: SECURELOGIC_ACTION_ENGINE_ENABLED is forced on for this file so
 * the `actions` write path (which has neither RLS nor any other isolation test)
 * is exercised; it is restored in afterAll. ANTHROPIC_API_KEY / RESEND_API_KEY
 * are untouched — the matcher core does not call them. (insights_trends has NO
 * writer on this path, verified — so there is nothing to isolate there.)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  bootstrapTestDb,
  seedVendor,
  seedRisk,
  seedCyberSignal,
  type TestDbSeed,
} from "./testDb.js";
import {
  runMatcherForSignal,
  type CyberSignalRecord,
} from "../../src/api/lib/cyberSignalProcessingService.js";

let seed: TestDbSeed;
let pool: Pool;
let prevActionFlag: string | undefined;

// org A vendors
let aMicrosoftVendorId: string;
// global signal ids
let globalMicrosoftSignalId: string;
let globalAcmeSignalId: string;
// per-org signal ids (for the brief SELECT)
let aPerOrgSignalId: string;
let bPerOrgSignalId: string;
let globalBriefSignalId: string;

// CyberSignalRecord inputs — only id/signal_type/severity/affected_vendor/
// affected_cve/normalized_summary are read by the matcher; organization_id is
// unused by runMatcherForSignal (the worker passes the "" global sentinel).
let microsoftRecord: CyberSignalRecord;
let acmeRecord: CyberSignalRecord;

async function count(sql: string, params: unknown[]): Promise<number> {
  const r = await pool.query<{ n: string }>(sql, params);
  return Number(r.rows[0].n);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the R5 pipeline isolation test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Force the action engine on so the matcher's actions write path is exercised.
  prevActionFlag = process.env.SECURELOGIC_ACTION_ENGINE_ENABLED;
  process.env.SECURELOGIC_ACTION_ENGINE_ENABLED = "true";

  // Vendors: "Microsoft" in BOTH orgs (matches both); "Acme" in org A ONLY.
  aMicrosoftVendorId = await seedVendor(pool, seed.orgA.id, { name: "Microsoft" });
  await seedVendor(pool, seed.orgA.id, { name: "Acme" });
  await seedVendor(pool, seed.orgB.id, { name: "Microsoft" });

  // One open Vendor Risk per org — phase-5 exposure flagging targets these.
  await seedRisk(pool, seed.orgA.id, { title: "Org A vendor risk" });
  await seedRisk(pool, seed.orgB.id, { title: "Org B vendor risk" });

  // GLOBAL signals (organization_id NULL) — the worker fan-out shape.
  globalMicrosoftSignalId = await seedCyberSignal(pool, {
    orgId: null, vendor: "Microsoft", severity: "High",
    summary: "Global breach affecting Microsoft", dedup: "r5-global-microsoft",
  });
  globalAcmeSignalId = await seedCyberSignal(pool, {
    orgId: null, vendor: "Acme", severity: "High",
    summary: "Global breach affecting Acme", dedup: "r5-global-acme",
  });

  // Per-org + global signals for the brief-generation SELECT (D.4).
  aPerOrgSignalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, vendor: "Microsoft", dedup: "r5-perorg-a" });
  bPerOrgSignalId = await seedCyberSignal(pool, { orgId: seed.orgB.id, vendor: "Microsoft", dedup: "r5-perorg-b" });
  globalBriefSignalId = await seedCyberSignal(pool, { orgId: null, vendor: "Globex", dedup: "r5-global-brief" });

  microsoftRecord = {
    id: globalMicrosoftSignalId,
    organization_id: "", // global sentinel; unused by runMatcherForSignal
    source: "harness",
    signal_type: "breach",
    severity: "High",
    normalized_summary: "Global breach affecting Microsoft",
    affected_vendor: "Microsoft",
    affected_cve: null,
  };
  acmeRecord = {
    id: globalAcmeSignalId,
    organization_id: "",
    source: "harness",
    signal_type: "breach",
    severity: "High",
    normalized_summary: "Global breach affecting Acme",
    affected_vendor: "Acme",
    affected_cve: null,
  };
}, 120_000);

afterAll(async () => {
  if (prevActionFlag === undefined) delete process.env.SECURELOGIC_ACTION_ENGINE_ENABLED;
  else process.env.SECURELOGIC_ACTION_ENGINE_ENABLED = prevActionFlag;
  await pool?.end();
});

describe("R5 — worker→matcher→brief cross-org isolation (real Postgres)", () => {
  // D.1 — a GLOBAL signal matched for org A writes ONLY org-A rows.
  it("D.1: global signal matched for org A produces org-A finding/suggestion/risk-flag/action and ZERO for org B", async () => {
    const res = await runMatcherForSignal(microsoftRecord, seed.orgA.id);

    // Positive: matched A's Microsoft vendor, created a finding, flagged one risk.
    expect(res.matched_vendor_id).toBe(aMicrosoftVendorId);
    expect(res.matched_branch).toBe("vendor_name_ilike");
    expect(res.finding).not.toBeNull();
    expect(res.risks_flagged).toBe(1);

    // findings — A has it, B does not (scoped to this exact signal).
    expect(await count("SELECT COUNT(*) n FROM findings WHERE organization_id=$1 AND source_type='cyber_signal' AND source_id=$2", [seed.orgA.id, globalMicrosoftSignalId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM findings WHERE organization_id=$1 AND source_type='cyber_signal' AND source_id=$2", [seed.orgB.id, globalMicrosoftSignalId])).toBe(0);

    // signal_match_suggestions — A has it, B does not.
    expect(await count("SELECT COUNT(*) n FROM signal_match_suggestions WHERE organization_id=$1 AND signal_id=$2", [seed.orgA.id, globalMicrosoftSignalId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM signal_match_suggestions WHERE organization_id=$1 AND signal_id=$2", [seed.orgB.id, globalMicrosoftSignalId])).toBe(0);

    // risk exposure flag — A's risk flagged by THIS signal, B's risk untouched.
    expect(await count("SELECT COUNT(*) n FROM risks WHERE organization_id=$1 AND exposure_flagged=TRUE AND exposure_signal_id=$2", [seed.orgA.id, globalMicrosoftSignalId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM risks WHERE organization_id=$1 AND exposure_flagged=TRUE", [seed.orgB.id])).toBe(0);

    // D.5 — actions write path (no RLS): A has an auto action, B has none yet.
    expect(await count("SELECT COUNT(*) n FROM actions WHERE organization_id=$1 AND source_type='finding'", [seed.orgA.id])).toBeGreaterThanOrEqual(1);
    expect(await count("SELECT COUNT(*) n FROM actions WHERE organization_id=$1", [seed.orgB.id])).toBe(0);
  });

  // D.2 — running the SAME global signal for org B makes B symmetric and leaves A unchanged.
  it("D.2: same global signal for org B is symmetric; org A's rows are unchanged (no retroactive bleed)", async () => {
    // Snapshot A before B's run.
    const aFindBefore = await count("SELECT COUNT(*) n FROM findings WHERE organization_id=$1 AND source_id=$2", [seed.orgA.id, globalMicrosoftSignalId]);
    const aRiskFlagBefore = await count("SELECT COUNT(*) n FROM risks WHERE organization_id=$1 AND exposure_flagged=TRUE", [seed.orgA.id]);
    const aActionsBefore = await count("SELECT COUNT(*) n FROM actions WHERE organization_id=$1", [seed.orgA.id]);

    const res = await runMatcherForSignal(microsoftRecord, seed.orgB.id);
    expect(res.finding).not.toBeNull();
    expect(res.risks_flagged).toBe(1);

    // B now symmetric to A.
    expect(await count("SELECT COUNT(*) n FROM findings WHERE organization_id=$1 AND source_type='cyber_signal' AND source_id=$2", [seed.orgB.id, globalMicrosoftSignalId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM signal_match_suggestions WHERE organization_id=$1 AND signal_id=$2", [seed.orgB.id, globalMicrosoftSignalId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM risks WHERE organization_id=$1 AND exposure_flagged=TRUE AND exposure_signal_id=$2", [seed.orgB.id, globalMicrosoftSignalId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM actions WHERE organization_id=$1 AND source_type='finding'", [seed.orgB.id])).toBeGreaterThanOrEqual(1);

    // A unchanged by B's run.
    expect(await count("SELECT COUNT(*) n FROM findings WHERE organization_id=$1 AND source_id=$2", [seed.orgA.id, globalMicrosoftSignalId])).toBe(aFindBefore);
    expect(await count("SELECT COUNT(*) n FROM risks WHERE organization_id=$1 AND exposure_flagged=TRUE", [seed.orgA.id])).toBe(aRiskFlagBefore);
    expect(await count("SELECT COUNT(*) n FROM actions WHERE organization_id=$1", [seed.orgA.id])).toBe(aActionsBefore);
  });

  // D.3 — overlapping vendor names are per-org inventory, not name-global.
  it("D.3: a global signal whose vendor exists only in org A is no_match for org B and writes nothing for B", async () => {
    const res = await runMatcherForSignal(acmeRecord, seed.orgB.id);

    expect(res.matched_branch).toBe("no_match");
    expect(res.matched_vendor_id).toBeNull();
    expect(res.matched_ai_system_id).toBeNull();
    expect(res.finding).toBeNull();

    expect(await count("SELECT COUNT(*) n FROM findings WHERE organization_id=$1 AND source_id=$2", [seed.orgB.id, globalAcmeSignalId])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM signal_match_suggestions WHERE organization_id=$1 AND signal_id=$2", [seed.orgB.id, globalAcmeSignalId])).toBe(0);
  });

  // D.4 — the brief-generation SELECT (briefScheduler.ts:255-260) is global-in / per-org-out.
  it("D.4: brief signal SELECT for org A returns A's rows + globals, never org B's per-org rows (and vice versa)", async () => {
    const periodStart = new Date(Date.now() - 3_600_000).toISOString();
    const periodEnd = new Date(Date.now() + 3_600_000).toISOString();

    // WHERE/ORDER copied verbatim from src/api/lib/briefScheduler.ts:255-260;
    // organization_id added to the projection only so the test can assert the
    // owning org of every returned row (the predicate under test is unchanged).
    const BRIEF_SELECT = `
      SELECT id, organization_id
      FROM cyber_signals
      WHERE (organization_id = $1 OR organization_id IS NULL)
        AND ingestion_timestamp >= $2
        AND ingestion_timestamp < $3
      ORDER BY ingestion_timestamp DESC`;

    const a = await pool.query<{ id: string; organization_id: string | null }>(BRIEF_SELECT, [seed.orgA.id, periodStart, periodEnd]);
    const aIds = a.rows.map((r) => r.id);
    expect(aIds).toContain(aPerOrgSignalId); // own per-org row
    expect(aIds).toContain(globalBriefSignalId); // global row
    expect(aIds).not.toContain(bPerOrgSignalId); // NEVER org B's per-org row
    // D.6 (R6 input-scoping at this layer): every row feeding org A's brief is
    // org-A-owned or global — no org-B-owned input can reach A's enrichment.
    expect(a.rows.every((r) => r.organization_id === seed.orgA.id || r.organization_id === null)).toBe(true);

    const b = await pool.query<{ id: string; organization_id: string | null }>(BRIEF_SELECT, [seed.orgB.id, periodStart, periodEnd]);
    const bIds = b.rows.map((r) => r.id);
    expect(bIds).toContain(bPerOrgSignalId);
    expect(bIds).toContain(globalBriefSignalId);
    expect(bIds).not.toContain(aPerOrgSignalId);
    expect(b.rows.every((r) => r.organization_id === seed.orgB.id || r.organization_id === null)).toBe(true);
  });
});
