/**
 * authAnomaly.test.ts — Tier 1 recordAccountLockout + Tier 2 runAuthAnomalyScan
 * (A04-G4/A09-G2). pg, auditLog, and the alerting webhook are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pgQuerySpy, sendSecurityAlertSpy } = vi.hoisted(() => ({
  pgQuerySpy: vi.fn(),
  sendSecurityAlertSpy: vi.fn()
}));

vi.mock("../infra/postgres.js", () => ({ pg: { query: pgQuerySpy }, pgElevated: { query: pgQuerySpy } }));
vi.mock("../infra/alerting.js", () => ({ sendSecurityAlert: sendSecurityAlertSpy }));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));

import { recordAccountLockout, runAuthAnomalyScan } from "../lib/authAnomaly.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const auditSpy = writeAuditEvent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  pgQuerySpy.mockReset();
  sendSecurityAlertSpy.mockReset();
  sendSecurityAlertSpy.mockResolvedValue(undefined);
  auditSpy.mockReset();
});

// ---------------------------------------------------------------------------
// Tier 1 — recordAccountLockout
// ---------------------------------------------------------------------------

describe("recordAccountLockout", () => {
  it("writes an auth.account_locked audit event and fires an account_locked alert", async () => {
    await recordAccountLockout({
      userId: "user-1",
      organizationId: "org-1",
      ip: "9.9.9.9",
      failedAttempts: 5,
      lockedUntil: new Date("2026-05-21T10:00:00.000Z"),
      maskedEmail: "alic***"
    });

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "auth.account_locked",
        actorUserId: "user-1",
        organizationId: "org-1",
        resourceType: "user",
        resourceId: "user-1",
        ipAddress: "9.9.9.9",
        payload: expect.objectContaining({ failed_attempts: 5, email: "alic***" })
      })
    );
    expect(sendSecurityAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "account_locked" })
    );
  });

  it("swallows a webhook failure — audit event still written, no throw", async () => {
    sendSecurityAlertSpy.mockRejectedValueOnce(new Error("webhook down"));

    await expect(
      recordAccountLockout({
        userId: "user-1",
        organizationId: "org-1",
        ip: null,
        failedAttempts: 5,
        lockedUntil: new Date(),
        maskedEmail: "x***"
      })
    ).resolves.toBeUndefined();

    expect(auditSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — runAuthAnomalyScan
// ---------------------------------------------------------------------------

describe("runAuthAnomalyScan", () => {
  it("does nothing when neither scan query returns an over-threshold IP", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [] }) // credential-stuffing scan
      .mockResolvedValueOnce({ rows: [] }); // api-key-probing scan

    const result = await runAuthAnomalyScan();

    expect(result).toEqual({ credentialStuffingIps: 0, apiKeyProbingIps: 0, alertsFired: 0 });
    expect(auditSpy).not.toHaveBeenCalled();
    expect(sendSecurityAlertSpy).not.toHaveBeenCalled();
  });

  it("alerts on a credential-stuffing IP when the dedup slot is won", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ ip_address: "5.5.5.5", account_count: "12" }] }) // stuffing scan
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "ledger-1" }] }) // claim — won
      .mockResolvedValueOnce({ rows: [] }); // probing scan

    const result = await runAuthAnomalyScan();

    // The credential-stuffing scan query is the first call.
    const scanSql = pgQuerySpy.mock.calls[0]?.[0] as string;
    expect(scanSql).toMatch(/auth\.login_failed/);
    expect(scanSql).toMatch(/COUNT\(DISTINCT payload->>'email'\)/);
    // The claim is an upsert with the cooldown WHERE guard.
    const claimSql = pgQuerySpy.mock.calls[1]?.[0] as string;
    expect(claimSql).toMatch(/ON CONFLICT \(anomaly_type, subject\) DO UPDATE/);

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "security.auth_anomaly_detected",
        ipAddress: "5.5.5.5",
        payload: expect.objectContaining({ anomaly_type: "credential_stuffing", distinct_accounts: 12 })
      })
    );
    expect(sendSecurityAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "credential_stuffing" })
    );
    expect(result).toMatchObject({ credentialStuffingIps: 1, alertsFired: 1 });
  });

  it("suppresses the alert when the dedup slot is still within cooldown (claim returns 0 rows)", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ ip_address: "5.5.5.5", account_count: "12" }] }) // stuffing scan
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // claim — lost (cooldown active)
      .mockResolvedValueOnce({ rows: [] }); // probing scan

    const result = await runAuthAnomalyScan();

    expect(auditSpy).not.toHaveBeenCalled();
    expect(sendSecurityAlertSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ credentialStuffingIps: 1, alertsFired: 0 });
  });

  it("alerts on an API-key-probing IP", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [] }) // stuffing scan
      .mockResolvedValueOnce({ rows: [{ ip_address: "7.7.7.7", hit_count: "30" }] }) // probing scan
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "ledger-2" }] }); // claim — won

    const result = await runAuthAnomalyScan();

    const probeSql = pgQuerySpy.mock.calls[1]?.[0] as string;
    expect(probeSql).toMatch(/auth\.invalid_api_key/);

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "security.auth_anomaly_detected",
        payload: expect.objectContaining({ anomaly_type: "api_key_probing", invalid_key_hits: 30 })
      })
    );
    expect(sendSecurityAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "api_key_probing" })
    );
    expect(result).toMatchObject({ apiKeyProbingIps: 1, alertsFired: 1 });
  });

  it("records the detection audit event even when webhook delivery fails", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ ip_address: "5.5.5.5", account_count: "15" }] }) // stuffing scan
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "ledger-3" }] }) // claim — won
      .mockResolvedValueOnce({ rows: [] }); // probing scan
    sendSecurityAlertSpy.mockRejectedValueOnce(new Error("webhook down"));

    const result = await runAuthAnomalyScan();

    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "security.auth_anomaly_detected" })
    );
    // Delivery failed but the detection was still counted + recorded.
    expect(result).toMatchObject({ alertsFired: 1 });
  });
});
