/**
 * authAnomalyLedger.test.ts — Tier-2 auth-anomaly identity package: proof over
 * REAL SQL that the anomaly pipeline end-to-end actually works — the half no
 * unit test can give, and the half that was silently dead in production (the
 * ledger had been empty for all time because rotating Cloudflare edge IPs
 * fragmented every attacker; see src/api/__tests__/authSurfaceClientIdentity
 * for the write-boundary fix).
 *
 * Proves, against the harness Postgres with the full migration set:
 *   1. LEDGER POPULATES — over-threshold activity from ONE identity creates
 *      auth_anomaly_alerts rows for BOTH detector types, and the scan reports
 *      the alerts.
 *   2. THRESHOLDS HOLD — activity below each threshold creates NOTHING.
 *   3. WINDOW HOLDS — over-threshold activity OLDER than the scan window
 *      creates nothing.
 *   4. NO ALERT STORM — an immediate re-scan of the same activity fires ZERO
 *      new alerts (ledger cooldown), while the ledger row records the claim.
 *
 * ALERT_WEBHOOK_URL is unset in the harness, so sendSecurityAlert no-ops by
 * design — webhook delivery is not under test here.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb } from "./testDb.js";

const STUFFING_IP = "203.0.113.77";
const PROBING_IP = "203.0.113.88";
const QUIET_IP = "203.0.113.99";
const STALE_IP = "203.0.113.111";
/** Every identity this test creates. All assertions are scoped to these. */
const FIXTURE_IPS = [STUFFING_IP, PROBING_IP, QUIET_IP, STALE_IP];

let pool: Pool;
let anomaly: typeof import("../../src/api/lib/authAnomaly.js");

async function seedEvents(args: {
  ip: string;
  eventType: "auth.login_failed" | "auth.invalid_api_key";
  count: number;
  distinctEmails?: boolean;
  ageMinutes?: number;
}): Promise<void> {
  for (let i = 0; i < args.count; i++) {
    const payload = args.distinctEmails ? { email: `u${i}**@x` } : {};
    await pool.query(
      `INSERT INTO security_audit_log (event_type, resource_type, payload, ip_address, created_at)
       VALUES ($1, 'auth', $2::jsonb, $3, now() - make_interval(mins => $4))`,
      [args.eventType, JSON.stringify(payload), args.ip, args.ageMinutes ?? 0]
    );
  }
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the anomaly ledger test.");
  await bootstrapTestDb();
  // Bind the app pools to the harness BEFORE importing app code (pattern shared
  // with the ask* isolation tests), and make sure the webhook stays unset.
  process.env.DATABASE_URL = url;
  delete process.env.MIGRATION_DATABASE_URL;
  delete process.env.ALERT_WEBHOOK_URL;
  anomaly = await import("../../src/api/lib/authAnomaly.js");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("Tier-2 auth-anomaly ledger over real SQL", () => {
  it("populates the ledger for over-threshold activity, holds thresholds and the window, and does not storm", async () => {
    // 1. Over-threshold: stuffing (>= distinct-account threshold, one IP) and
    //    probing (>= hit threshold, one IP).
    await seedEvents({
      ip: STUFFING_IP,
      eventType: "auth.login_failed",
      count: anomaly.CRED_STUFFING_DISTINCT_ACCOUNTS,
      distinctEmails: true
    });
    await seedEvents({
      ip: PROBING_IP,
      eventType: "auth.invalid_api_key",
      count: anomaly.API_KEY_PROBE_COUNT
    });
    // 2. Below-threshold identity: one short of each limit.
    await seedEvents({
      ip: QUIET_IP,
      eventType: "auth.invalid_api_key",
      count: anomaly.API_KEY_PROBE_COUNT - 1
    });
    // 3. Over-threshold but OUTSIDE the scan window.
    await seedEvents({
      ip: STALE_IP,
      eventType: "auth.invalid_api_key",
      count: anomaly.API_KEY_PROBE_COUNT,
      ageMinutes: anomaly.SCAN_WINDOW_MINUTES + 10
    });

    const first = await anomaly.runAuthAnomalyScan();
    expect(first.credentialStuffingIps).toBe(1);
    expect(first.apiKeyProbingIps).toBe(1);
    expect(first.alertsFired).toBe(2);

    // Scoped to THIS test's fixture IPs. The suite shares one database and
    // performs no inter-file cleanup, so an unscoped read over
    // auth_anomaly_alerts / security_audit_log would let any other file's rows
    // decide this result. Scoping removes that coupling without relaxing what
    // is asserted: both over-threshold IPs must still appear, and the
    // below-threshold and out-of-window IPs must still be absent.
    const ledger = await pool.query<{ anomaly_type: string; subject: string; alert_count: number }>(
      `SELECT anomaly_type, subject, alert_count FROM auth_anomaly_alerts
        WHERE subject = ANY($1::text[]) ORDER BY anomaly_type`,
      [FIXTURE_IPS]
    );
    expect(ledger.rows).toEqual([
      expect.objectContaining({ anomaly_type: "api_key_probing", subject: PROBING_IP }),
      expect.objectContaining({ anomaly_type: "credential_stuffing", subject: STUFFING_IP })
    ]);
    const subjects = ledger.rows.map(r => r.subject);
    expect(subjects).not.toContain(QUIET_IP);
    expect(subjects).not.toContain(STALE_IP);

    // The detection is also durably recorded in the audit log itself.
    const detections = await pool.query(
      `SELECT ip_address FROM security_audit_log
        WHERE event_type = 'security.auth_anomaly_detected'
          AND ip_address = ANY($1::text[]) ORDER BY ip_address`,
      [FIXTURE_IPS]
    );
    expect(detections.rows.map(r => r.ip_address)).toEqual([STUFFING_IP, PROBING_IP].sort());

    // 4. Immediate re-scan: same over-threshold rows are still in the window,
    //    but the ledger cooldown suppresses every re-alert — no storm.
    const second = await anomaly.runAuthAnomalyScan();
    expect(second.credentialStuffingIps).toBe(1);
    expect(second.apiKeyProbingIps).toBe(1);
    expect(second.alertsFired).toBe(0);

    const after = await pool.query(
      `SELECT count(*)::int AS n FROM auth_anomaly_alerts WHERE subject = ANY($1::text[])`,
      [FIXTURE_IPS]
    );
    expect(after.rows[0].n).toBe(2); // no new rows, only the original claims
  }, 60_000);

  it("is unaffected by unrelated anomaly rows left in the shared database", async () => {
    // The suite shares one database and does not clean between files, so this
    // test must hold with foreign rows present. Plant both kinds of noise a
    // neighbouring file could leave — a ledger claim and a detection audit row
    // for an IP this test knows nothing about — and re-assert.
    const FOREIGN_IP = "198.51.100.5";
    await pool.query(
      `INSERT INTO auth_anomaly_alerts (anomaly_type, subject) VALUES ('api_key_probing', $1)
         ON CONFLICT (anomaly_type, subject) DO NOTHING`,
      [FOREIGN_IP]
    );
    await pool.query(
      `INSERT INTO security_audit_log (event_type, resource_type, payload, ip_address)
       VALUES ('security.auth_anomaly_detected', 'ip_address', '{}'::jsonb, $1)`,
      [FOREIGN_IP]
    );

    const detections = await pool.query(
      `SELECT ip_address FROM security_audit_log
        WHERE event_type = 'security.auth_anomaly_detected'
          AND ip_address = ANY($1::text[]) ORDER BY ip_address`,
      [FIXTURE_IPS]
    );
    expect(detections.rows.map(r => r.ip_address)).toEqual([STUFFING_IP, PROBING_IP].sort());

    const ledger = await pool.query<{ subject: string }>(
      `SELECT subject FROM auth_anomaly_alerts WHERE subject = ANY($1::text[])`,
      [FIXTURE_IPS]
    );
    expect(ledger.rows.map(r => r.subject).sort()).toEqual([STUFFING_IP, PROBING_IP].sort());
    // And the foreign rows really were present — otherwise this proves nothing.
    const foreign = await pool.query(
      `SELECT count(*)::int AS n FROM auth_anomaly_alerts WHERE subject = $1`,
      [FOREIGN_IP]
    );
    expect(foreign.rows[0].n).toBe(1);
  }, 60_000);
});
