/**
 * signalRecencyWindow.test.ts — IQP Q2 brief-window recency branch, real Postgres.
 *
 * The Q2 unit suite (src/api/__tests__/signalRecency.test.ts) proves
 * derivePublishedAt and the flag default; it structurally cannot prove the
 * WINDOW QUERY itself — the SQL branch briefScheduler.ts switches on
 * signalRecencyEnabled(). This suite pins that predicate against the real
 * schema (audit release gate G4: "old-dateAdded / fresh-ingestion fixture is
 * suppressed").
 *
 * The three statements under test are copied VERBATIM from
 * src/api/lib/briefScheduler.ts (generateAndStoreBrief):
 *   - legacy branch  (flag OFF): ingestion_timestamp window
 *   - recency branch (flag ON):  COALESCE(published_at, ingestion_timestamp)
 *   - suppression counter:       stale_signal_suppressed telemetry query
 * If the scheduler's SQL changes, update the copies here in the same PR —
 * this file is the drift alarm.
 *
 * Staging evidence this pins (2026-08-07, [SEED] Walkthrough Org): the
 * 2026-07-26→08-02 brief carried CVE-2010-0188 (2010) and CVE-2002-0367
 * (2002) as "this period" — old-dateAdded KEV rows freshly re-ingested.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

const DAY = 24 * 60 * 60 * 1000;

// Copied verbatim from briefScheduler.ts (recency branch / legacy branch).
const RECENCY_SQL = `SELECT id, signal_type, severity, normalized_summary,
        affected_cve, affected_vendor, source, ingestion_timestamp,
        cluster_key, raw_payload
 FROM cyber_signals
 WHERE (organization_id = $1 OR organization_id IS NULL)
   AND COALESCE(published_at, ingestion_timestamp) >= $2
   AND COALESCE(published_at, ingestion_timestamp) < $3
 ORDER BY ingestion_timestamp DESC`;

const LEGACY_SQL = `SELECT id, signal_type, severity, normalized_summary,
        affected_cve, affected_vendor, source, ingestion_timestamp,
        cluster_key, raw_payload
 FROM cyber_signals
 WHERE (organization_id = $1 OR organization_id IS NULL)
   AND ingestion_timestamp >= $2
   AND ingestion_timestamp < $3
 ORDER BY ingestion_timestamp DESC`;

const SUPPRESSED_SQL = `SELECT COUNT(*)::int AS n
 FROM cyber_signals
 WHERE (organization_id = $1 OR organization_id IS NULL)
   AND ingestion_timestamp >= $2 AND ingestion_timestamp < $3
   AND published_at IS NOT NULL AND published_at < $2`;

let seed: TestDbSeed;
let pool: Pool;

const periodEnd = new Date("2026-08-04T07:00:00Z");
const periodStart = new Date(periodEnd.getTime() - 7 * DAY);

async function insertSignal(opts: {
  dedup: string;
  cve: string;
  ingestedAt: Date;
  publishedAt: Date | null;
  orgId?: string | null;
}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO cyber_signals
       (organization_id, source, signal_type, severity, normalized_summary,
        affected_cve, dedup_hash, ingestion_timestamp, published_at)
     VALUES ($1, 'cisa_kev', 'cve', 'High', $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      opts.orgId ?? null,
      `KEV entry ${opts.cve}`,
      opts.cve,
      opts.dedup,
      opts.ingestedAt.toISOString(),
      opts.publishedAt ? opts.publishedAt.toISOString() : null,
    ],
  );
  return r.rows[0]!.id;
}

let freshId: string;
let staleKevId: string;
let unknownDateId: string;
let oldIngestId: string;
let otherOrgId: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the recency-window test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // The four shapes that matter, all global (organization_id NULL — the KEV
  // poller's shape), plus one org-B row to pin tenant scoping:
  //   fresh        current dateAdded, current ingest  → in window both branches
  //   staleKev     2010 dateAdded, ingested THIS WEEK → the BR-2 defect row
  //   unknownDate  no published_at, current ingest    → ingestion fallback, both
  //   oldIngest    no published_at, ingested weeks ago→ outside both branches
  freshId = await insertSignal({
    dedup: "rw-fresh", cve: "CVE-2026-20316",
    ingestedAt: new Date(periodEnd.getTime() - 2 * DAY),
    publishedAt: new Date(periodEnd.getTime() - 3 * DAY),
  });
  staleKevId = await insertSignal({
    dedup: "rw-stale", cve: "CVE-2010-0188",
    ingestedAt: new Date(periodEnd.getTime() - 1 * DAY),
    publishedAt: new Date("2010-03-01T00:00:00Z"),
  });
  unknownDateId = await insertSignal({
    dedup: "rw-nodate", cve: "CVE-2026-11111",
    ingestedAt: new Date(periodEnd.getTime() - 3 * DAY),
    publishedAt: null,
  });
  oldIngestId = await insertSignal({
    dedup: "rw-oldingest", cve: "CVE-2026-22222",
    ingestedAt: new Date(periodEnd.getTime() - 30 * DAY),
    publishedAt: null,
  });
  otherOrgId = await insertSignal({
    dedup: "rw-otherorg", cve: "CVE-2026-33333",
    ingestedAt: new Date(periodEnd.getTime() - 2 * DAY),
    publishedAt: new Date(periodEnd.getTime() - 2 * DAY),
    orgId: seed.orgB.id,
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

function idsOf(rows: Array<{ id: string }>): Set<string> {
  return new Set(rows.map((r) => r.id));
}

describe("brief window recency branch (real Postgres)", () => {
  const params = () => [
    seed.orgA.id,
    periodStart.toISOString(),
    periodEnd.toISOString(),
  ];

  it("legacy branch (flag OFF): the stale-KEV row IS 'this period' — the BR-2 defect, pinned", async () => {
    const r = await pool.query<{ id: string }>(LEGACY_SQL, params());
    const ids = idsOf(r.rows);
    expect(ids.has(freshId)).toBe(true);
    expect(ids.has(staleKevId)).toBe(true); // 2010 CVE presented as current
    expect(ids.has(unknownDateId)).toBe(true);
    expect(ids.has(oldIngestId)).toBe(false);
  });

  it("recency branch (flag ON): the stale-KEV row is suppressed; unknown-date rows keep ingestion-time behavior", async () => {
    const r = await pool.query<{ id: string }>(RECENCY_SQL, params());
    const ids = idsOf(r.rows);
    expect(ids.has(freshId)).toBe(true);
    expect(ids.has(staleKevId)).toBe(false); // G4: old-dateAdded / fresh-ingestion suppressed
    expect(ids.has(unknownDateId)).toBe(true); // no event date → ingestion fallback preserved
    expect(ids.has(oldIngestId)).toBe(false);
  });

  it("suppression telemetry counts exactly the stale-KEV shape", async () => {
    const r = await pool.query<{ n: number }>(SUPPRESSED_SQL, params());
    expect(r.rows[0]!.n).toBe(1);
  });

  it("both branches exclude other orgs' rows while including global rows", async () => {
    for (const sql of [LEGACY_SQL, RECENCY_SQL]) {
      const r = await pool.query<{ id: string }>(sql, params());
      expect(idsOf(r.rows).has(otherOrgId)).toBe(false);
    }
    // …and org B sees its own row through the same predicate.
    const rb = await pool.query<{ id: string }>(RECENCY_SQL, [
      seed.orgB.id, periodStart.toISOString(), periodEnd.toISOString(),
    ]);
    expect(idsOf(rb.rows).has(otherOrgId)).toBe(true);
  });
});
