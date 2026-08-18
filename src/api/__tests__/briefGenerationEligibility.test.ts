/**
 * briefGenerationEligibility.test.ts — the ADR-0007 contract: brief generation
 * is an organizational entitlement, decoupled from intelligence_brief_subscribers.
 *
 * Two layers, matching the house style for scheduler coverage:
 *   1. Behavior tests for listBriefEligibleOrgIds (the single eligibility
 *      computation) against a mocked elevated pool.
 *   2. Source-shape tests on briefScheduler.ts / briefEmailSender.ts (same
 *      pattern as briefSchedulerFeedHealthWiring.test.ts) proving the wiring:
 *      the scheduler never consults the subscriber table, generation precedes
 *      delivery, and a zero-recipient send is recorded — not fatal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: vi.fn() },
  pg: { query: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
  requireTenantContext: vi.fn()
}));

import { listBriefEligibleOrgIds } from "../lib/briefEligibility.js";
import { pgElevated } from "../infra/postgres.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schedulerSource = readFileSync(path.resolve(here, "../lib/briefScheduler.ts"), "utf8");
const eligibilitySource = readFileSync(path.resolve(here, "../lib/briefEligibility.ts"), "utf8");
const senderSource = readFileSync(path.resolve(here, "../lib/briefEmailSender.ts"), "utf8");

describe("listBriefEligibleOrgIds (the single eligibility computation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns every active org — an org with zero subscriber rows is eligible by construction", async () => {
    // The query never touches subscribers, so subscriber state cannot exclude
    // an org. These three ids stand for: org with recipients, org that never
    // had a recipient, org whose last recipient unsubscribed.
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [{ id: "org-with-recipients" }, { id: "org-never-enrolled" }, { id: "org-last-recipient-unsubscribed" }]
    } as never);

    const orgIds = await listBriefEligibleOrgIds();

    expect(orgIds).toEqual([
      "org-with-recipients",
      "org-never-enrolled",
      "org-last-recipient-unsubscribed"
    ]);
  });

  it("eligibility comes from organizations.status = 'active' — suspended orgs are excluded by the predicate", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);

    await listBriefEligibleOrgIds();

    const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("FROM organizations");
    expect(sql).toContain("status = 'active'");
  });

  // ── The architectural invariant, not the current implementation ──────────
  // "Brief generation eligibility is derived solely from active platform
  // organization entitlement." The assertions below fail ANY equivalent
  // reintroduction of subscriber-based (or other-table-based) eligibility,
  // not just a reuse of the retired SQL.

  it("INVARIANT: eligibility issues exactly one query, reading ONLY the organizations table", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);

    await listBriefEligibleOrgIds();

    expect(pgElevated.query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
    const tables = [...sql.matchAll(/(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["organizations"]);
  });

  it("INVARIANT: the eligibility module's SQL touches no table other than organizations", () => {
    // Case-sensitive: SQL keywords are uppercase here; prose comments say
    // "from" in lowercase. Any FROM/JOIN of another table — subscribers or an
    // equivalent — fails this, whatever the query looks like.
    const tables = [...eligibilitySource.matchAll(/(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect([...new Set(tables)]).toEqual(["organizations"]);
  });

  it("INVARIANT: the eligibility module imports only the database infra — no side doors", () => {
    const imports = [...eligibilitySource.matchAll(/from "(.+?)";/g)].map((m) => m[1]);
    expect(imports).toEqual(["../infra/postgres.js"]);
  });

  it("INVARIANT: the enumerated set is returned unfiltered — no post-query exclusion logic", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    vi.mocked(pgElevated.query).mockResolvedValue({ rows } as never);

    const orgIds = await listBriefEligibleOrgIds();

    expect(orgIds).toEqual(["a", "b", "c"]);
    expect(orgIds).toHaveLength(rows.length);
  });
});

describe("briefScheduler.ts source — generation decoupled from subscribers (ADR-0007)", () => {
  it("enumerates orgs via listBriefEligibleOrgIds, not the subscriber table", () => {
    expect(schedulerSource).toMatch(/orgIds = await listBriefEligibleOrgIds\(\)/);
  });

  it("never queries intelligence_brief_subscribers (the retired coupling) — comments may explain it, SQL may not touch it", () => {
    // SQL keywords are uppercase in this codebase; prose comments say "from"
    // in lowercase, so the check is deliberately case-sensitive.
    expect(schedulerSource).not.toMatch(/FROM\s+intelligence_brief_subscribers/);
    expect(schedulerSource).not.toMatch(/JOIN\s+intelligence_brief_subscribers/);
  });

  it("generates and publishes BEFORE any recipient resolution — sendBrief is downstream of generateAndStoreBrief", () => {
    // Matches the CALL, not the assignment form: generateAndStoreBrief now
    // returns { briefId, enrichment } so the org-completion telemetry can
    // report provider-degradation counters. The invariant under test is the
    // ORDER — generation strictly before any recipient resolution — which is
    // unchanged.
    const generateIdx = schedulerSource.indexOf("await generateAndStoreBrief(orgId)");
    const sendIdx = schedulerSource.indexOf("await sendBrief(briefId, orgId)");
    expect(generateIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(generateIdx);
  });

  it("records a zero-recipient send as a skip (reason + counters), never as a generation failure", () => {
    expect(schedulerSource).toMatch(
      /if \(sendResult\.skipped\) \{[\s\S]*?emails_skipped_no_recipients\+\+[\s\S]*?orgs_without_recipients\.push\(orgId\)[\s\S]*?scheduler_brief_send_skipped_no_recipients/
    );
  });

  it("tracks the active-org population in the run summary for health verdicts", () => {
    expect(schedulerSource).toMatch(/summary\.active_orgs = orgIds\.length/);
  });

  it("INVARIANT: orgIds is assigned exactly once — from the eligibility seam — and never filtered or reassigned", () => {
    // A future subscriber-based (or any other) narrowing of the generation
    // population would need either a second assignment or a filter on orgIds;
    // both fail here regardless of what the narrowing queries.
    const assignments = schedulerSource.match(/orgIds\s*=[^=]/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toContain("orgIds =");
    expect(schedulerSource).toMatch(/orgIds = await listBriefEligibleOrgIds\(\)/);
    expect(schedulerSource).not.toMatch(/orgIds\s*\.\s*filter/);
  });
});

describe("briefEmailSender.ts source — delivery behavior unchanged when recipients exist", () => {
  it("still resolves email recipients from active intelligence_brief_subscribers rows", () => {
    expect(senderSource).toMatch(
      /FROM intelligence_brief_subscribers[\s\S]*?WHERE organization_id = \$1 AND active = TRUE/
    );
  });

  it("still early-returns a skip (not a throw) when the org has no active recipients", () => {
    expect(senderSource).toMatch(
      /subscribers\.length === 0[\s\S]*?skipped: true[\s\S]*?no_active_subscribers/
    );
  });
});
