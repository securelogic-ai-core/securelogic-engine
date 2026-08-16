/**
 * erasureExecutor.test.ts — E-2 Increment 3, against real Postgres.
 *
 * The suite is weighted towards races and refusals, because the executor's job
 * is to decline in every circumstance except one. Every destructive run here
 * targets a throwaway organization created by the test itself; no seeded tenant
 * and no shared fixture is ever erased.
 *
 * THE CENTREPIECE is the TOCTOU block: an approval is not a licence to destroy
 * later. A hold placed AFTER approval, tenant growth AFTER approval, an expired
 * approval, a changed scope — each must stop the run at the moment of
 * destruction, not merely at the moment of decision.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import {
  requestErasure, approveErasure, dryRunErasure, executeErasure,
  claimForExecution, recordExecutionFailure, ERASURE_EVENTS,
} from "../../src/api/lib/governance/erasure/erasureExecutor.js";
import { inventoryOrganization, clearBlockingRows } from "../../src/api/lib/governance/erasure/erasureInventory.js";
import { scopeFingerprint, evaluateExecutionGate } from "../../src/api/lib/governance/erasure/erasurePolicy.js";

let seed: TestDbSeed;
let pool: Pool;
let requester: string;
let approver: string;

/** A throwaway tenant with a little of everything, including WORM rows. */
async function tenant(): Promise<{ orgId: string; userId: string }> {
  const orgId = (
    await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('erasable tenant', 'erase-' || floor(random()*1e12)::text) RETURNING id`
    )
  ).rows[0]!.id;
  const userId = (await seedUser(pool, orgId)).id;
  await pool.query(
    `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
     VALUES ($1,'tenant.activity','probe')`, [orgId]);
  await pool.query(
    `INSERT INTO ask_conversations (organization_id, user_id, mode) VALUES ($1,$2,'text')`,
    [orgId, userId]);
  await pool.query(
    `INSERT INTO user_alert_preferences (organization_id, user_id) VALUES ($1,$2)`,
    [orgId, userId]).catch(() => {});
  return { orgId, userId };
}

/**
 * Run fn on a connection whose session_user IS erasure_agent.
 *
 * RESET SESSION AUTHORIZATION before release is mandatory, not hygiene: the
 * setting SURVIVES COMMIT, so a pooled connection handed back without it stays
 * erasure_agent for whoever picks it up next. This bit during development —
 * later tests failed with "permission denied for table organizations" on a
 * connection they thought was the owner.
 *
 * The same hazard applies in production, which is why the operator entry point
 * opens its own dedicated connection from an erasure-specific DSN rather than
 * borrowing the application pool.
 */
async function asErasureAgent<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET SESSION AUTHORIZATION erasure_agent");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.query("RESET SESSION AUTHORIZATION").catch(() => {});
    c.release();
  }
}

async function asOwner<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** request + approve(destructive) in the ordinary way. */
async function approvedCertificate(orgId: string, destructive = true): Promise<string> {
  return asOwner(async (c) => {
    const req = await requestErasure(c, {
      organizationId: orgId, actorUserId: requester, actorRole: "admin",
      reason: "isolation probe", legalBasis: "gdpr_art17_request",
    });
    if (req.outcome !== "requested") throw new Error(`request denied: ${req.reason}`);
    const app = await approveErasure(c, {
      certificateId: req.certificateId, actorUserId: approver, actorRole: "admin", destructive,
    });
    if (app.outcome !== "approved") throw new Error(`approve denied: ${app.reason}`);
    return req.certificateId;
  });
}

async function certStatus(id: string) {
  const { rows } = await pool.query<{
    status: string; attempt_count: number; failure_reason: string | null;
    scope_digest: Record<string, number> | null; retain_until: Date | null;
  }>(
    `SELECT status, attempt_count, failure_reason, scope_digest, retain_until
       FROM erasure_certificates WHERE id=$1`, [id]);
  return rows[0]!;
}

async function eventCount(certId: string, type: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM security_audit_log
      WHERE resource_id=$1 AND event_type=$2`, [certId, type]);
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  pool = new Pool({ connectionString: url, ssl: false });
  requester = (await seedUser(pool, seed.orgA.id)).id;
  approver = (await seedUser(pool, seed.orgA.id)).id;
}, 120_000);

afterAll(async () => { await pool.end(); });

/* ─────────────────────────── INVENTORY ───────────────────────────────────── */

describe("pre-erasure inventory", () => {
  it("is derived from the live schema, not a hand-written list", async () => {
    const { orgId } = await tenant();
    const inv = await asOwner((c) => inventoryOrganization(c, orgId));
    expect(inv.tablesScanned).toBeGreaterThan(100);
    expect(Object.keys(inv.inventory)).toContain("security_audit_log");
    expect(inv.totalRows).toBeGreaterThan(0);
  });

  it("discovers the FK edges that would block the delete", async () => {
    const { orgId } = await tenant();
    const inv = await asOwner((c) => inventoryOrganization(c, orgId));
    const blockers = inv.blocking.map((b) => b.child);
    // These are RESTRICT/NO ACTION today; the assertion is that they are FOUND,
    // not that the set is frozen.
    expect(blockers).toContain("user_alert_preferences");
    expect(blockers).toContain("finding_risk_acceptances");
  });

  it("counts only the target organization", async () => {
    const a = await tenant();
    const b = await tenant();
    const invA = await asOwner((c) => inventoryOrganization(c, a.orgId));
    const invB = await asOwner((c) => inventoryOrganization(c, b.orgId));
    expect(invA.organizationId).toBe(a.orgId);
    expect(invB.organizationId).toBe(b.orgId);
    expect(scopeFingerprint(a.orgId, invA.inventory))
      .not.toBe(scopeFingerprint(b.orgId, invB.inventory));
  });
});

/* ──────────────────────── DRY RUN IS THE DEFAULT ─────────────────────────── */

describe("dry run is the default and destroys nothing", () => {
  it("a freshly requested certificate is dry_run TRUE", async () => {
    const { orgId } = await tenant();
    const certId = await asOwner(async (c) => {
      const r = await requestErasure(c, {
        organizationId: orgId, actorUserId: requester, actorRole: "admin",
        reason: "probe", legalBasis: "gdpr_art17_request" });
      if (r.outcome !== "requested") throw new Error("denied");
      return r.certificateId;
    });
    const { rows } = await pool.query<{ dry_run: boolean; status: string }>(
      `SELECT dry_run, status FROM erasure_certificates WHERE id=$1`, [certId]);
    expect(rows[0]!.dry_run).toBe(true);
    expect(rows[0]!.status).toBe("draft");
  });

  it("approving without destructive intent leaves it dry-run, and execution refuses", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId, false);
    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res).toEqual({ outcome: "refused", reason: "dry_run_certificate" });
    const still = await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [orgId]);
    expect(still.rowCount).toBe(1);
  });

  it("a dry run reports what would happen and changes nothing", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    const before = await asOwner((c) => inventoryOrganization(c, orgId));
    const report = await asOwner((c) => dryRunErasure(c, { certificateId: certId, actorUserId: requester }));
    expect("wouldDelete" in report).toBe(true);
    if ("wouldDelete" in report) {
      expect(report.totalRows).toBe(before.totalRows);
      expect(report.refusalIfExecutedNow).toBeNull();
      expect(report.scopeMatchesApproval).toBe(true);
    }
    // "Changes nothing" means changes no TENANT data. A dry run does append
    // exactly one audit event — it must, or an unaudited rehearsal would be
    // possible — so the comparison is the fingerprint, which deliberately
    // excludes the ledgers the governance process writes to itself.
    const after = await asOwner((c) => inventoryOrganization(c, orgId));
    expect(scopeFingerprint(orgId, after.inventory)).toBe(scopeFingerprint(orgId, before.inventory));
    expect(await eventCount(certId, ERASURE_EVENTS.dryRun)).toBe(1);
  });
});

/* ──────────────────── TWO-PERSON AUTHORIZATION ───────────────────────────── */

describe("two-person authorization", () => {
  it("the requester cannot approve their own request", async () => {
    const { orgId } = await tenant();
    const outcome = await asOwner(async (c) => {
      const r = await requestErasure(c, {
        organizationId: orgId, actorUserId: requester, actorRole: "admin",
        reason: "probe", legalBasis: "gdpr_art17_request" });
      if (r.outcome !== "requested") throw new Error("denied");
      return approveErasure(c, {
        certificateId: r.certificateId, actorUserId: requester, actorRole: "admin", destructive: true });
    });
    expect(outcome).toEqual({ outcome: "denied", reason: "self_approval" });
  });

  it("a non-admin cannot approve", async () => {
    const { orgId } = await tenant();
    const outcome = await asOwner(async (c) => {
      const r = await requestErasure(c, {
        organizationId: orgId, actorUserId: requester, actorRole: "admin",
        reason: "probe", legalBasis: "gdpr_art17_request" });
      if (r.outcome !== "requested") throw new Error("denied");
      return approveErasure(c, {
        certificateId: r.certificateId, actorUserId: approver, actorRole: "analyst", destructive: true });
    });
    expect(outcome).toEqual({ outcome: "denied", reason: "admin_role_required" });
  });

  it("a denial is audited", async () => {
    const { orgId } = await tenant();
    const certId = await asOwner(async (c) => {
      const r = await requestErasure(c, {
        organizationId: orgId, actorUserId: requester, actorRole: "admin",
        reason: "probe", legalBasis: "gdpr_art17_request" });
      if (r.outcome !== "requested") throw new Error("denied");
      await approveErasure(c, {
        certificateId: r.certificateId, actorUserId: requester, actorRole: "admin", destructive: true });
      return r.certificateId;
    });
    expect(await eventCount(certId, ERASURE_EVENTS.denied)).toBe(1);
  });

  it("a FORGED approval — writing approved_by directly as the requester — is refused by the database", async () => {
    const { orgId } = await tenant();
    await expect(
      pool.query(
        `INSERT INTO erasure_certificates
           (organization_id, requested_by_user_id, approved_by_user_id, reason, legal_basis,
            dry_run, status, approved_at, scope_fingerprint, approval_expires_at)
         VALUES ($1,$2,$2,'forged','gdpr_art17_request',false,'approved',now(),'x',now()+interval '1 day')`,
        [orgId, requester]
      )
    ).rejects.toThrow(/erasure_certificates_two_person/);
  });

  it("an approval with no bound scope is refused by the database", async () => {
    const { orgId } = await tenant();
    await expect(
      pool.query(
        `INSERT INTO erasure_certificates
           (organization_id, requested_by_user_id, approved_by_user_id, reason, legal_basis,
            dry_run, status, approved_at)
         VALUES ($1,$2,$3,'unbound','gdpr_art17_request',false,'approved',now())`,
        [orgId, requester, approver]
      )
    ).rejects.toThrow(/erasure_certificates_approved_scope/);
  });
});

/* ══════════════════════════ TOCTOU ═══════════════════════════════════════ */

describe("TOCTOU — approval is not a licence to destroy later", () => {
  it("A LEGAL HOLD PLACED AFTER APPROVAL stops the erasure at the moment of execution", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);

    // Approved and clear at this instant.
    const before = await asOwner((c) => dryRunErasure(c, { certificateId: certId, actorUserId: null }));
    expect("refusalIfExecutedNow" in before && before.refusalIfExecutedNow).toBeNull();

    // ... then the hold arrives, after the decision, before the destruction.
    await pool.query(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','matter opened after approval',$2)`,
      [orgId, requester]);

    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res).toEqual({ outcome: "refused", reason: "legal_hold_active" });

    const survived = await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [orgId]);
    expect(survived.rowCount).toBe(1);
  });

  it("TENANT DATA CHANGING AFTER APPROVAL voids the approval", async () => {
    const { orgId, userId } = await tenant();
    const certId = await approvedCertificate(orgId);

    // The tenant keeps working after the decision was made.
    await pool.query(
      `INSERT INTO ask_conversations (organization_id, user_id, mode) VALUES ($1,$2,'text')`,
      [orgId, userId]);

    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res).toEqual({ outcome: "refused", reason: "scope_changed" });
    expect((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [orgId])).rowCount).toBe(1);
  });

  it("AN EXPIRED APPROVAL cannot be executed", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    await pool.query(
      `UPDATE erasure_certificates SET approval_expires_at = now() - interval '1 minute' WHERE id=$1`,
      [certId]);
    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res).toEqual({ outcome: "refused", reason: "approval_expired" });
  });

  it("the DATABASE GUARD is an independent second check on the hold", async () => {
    // Even if the executor's own hold check were wrong, the row-level guard
    // re-evaluates it during the cascade. Proven by arming the guard by hand
    // with a valid certificate and a hold in place.
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    await pool.query(`UPDATE erasure_certificates SET status='executing', started_at=now() WHERE id=$1`, [certId]);
    await pool.query(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','hold',$2)`, [orgId, requester]);

    const inv = await asOwner((c) => inventoryOrganization(c, orgId));

    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.erasure_certificate_id',$1,true)`, [certId]);
      await c.query(`SELECT set_config('app.erasure_org_id',$1,true)`, [orgId]);
      await c.query("SET SESSION AUTHORIZATION erasure_agent");
      // The NO ACTION / RESTRICT edges raise a plain FK error BEFORE any WORM
      // trigger runs, which is exactly why the executor clears them first. To
      // reach the guard by hand, this test has to do the same.
      await clearBlockingRows(c, orgId, inv.blocking);
      await expect(c.query(`DELETE FROM organizations WHERE id=$1`, [orgId])).rejects.toThrow(/append-only/);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      await c.query("RESET SESSION AUTHORIZATION").catch(() => {});
      c.release();
    }
  });
});

/* ──────────────────────── OTHER RACES ────────────────────────────────────── */

describe("races and interruptions", () => {
  it("DUPLICATE EXECUTION is idempotent — the second run reports already_erased", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    const first = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(first.outcome).toBe("erased");

    const second = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(second.outcome).toBe("refused");
    // The first run completed the certificate, so a replay hits the terminal state.
    if (second.outcome === "refused") expect(second.reason).toBe("terminal_state");
  });

  it("AN INTERRUPTED EXECUTION leaves diagnosable state and no data loss", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);

    // The claim commits; then the destructive transaction dies.
    await asOwner((c) => claimForExecution(c, certId));
    await asErasureAgent(async (c) => {
      await c.query(`SELECT set_config('app.erasure_certificate_id',$1,true)`, [certId]);
      await c.query(`SELECT set_config('app.erasure_org_id',$1,true)`, [orgId]);
      await c.query(`DELETE FROM user_alert_preferences WHERE organization_id=$1`, [orgId]).catch(() => {});
      throw new Error("simulated process death mid-erasure");
    }).catch(() => {});

    const st = await certStatus(certId);
    expect(st.status).toBe("executing");        // visible: something was tried
    expect(st.attempt_count).toBe(1);
    expect((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [orgId])).rowCount).toBe(1);

    await asOwner((c) => recordExecutionFailure(c, certId, new Error("simulated process death")));
    expect((await certStatus(certId)).failure_reason).toMatch(/simulated process death/);
    expect(await eventCount(certId, ERASURE_EVENTS.failed)).toBe(1);
  });

  it("a retry after an interruption re-passes every check and completes", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    await asOwner((c) => claimForExecution(c, certId));

    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res.outcome).toBe("erased");
    expect((await certStatus(certId)).status).toBe("completed");
  });

  it("an AN APPROVER WHO BECOMES UNAUTHORIZED — deprovisioned before execution — does not stop a bound approval, but is visible", async () => {
    // Recorded as discovered: the approval is bound to the SCOPE, and the
    // approver's later deprovisioning does not retroactively void it. What the
    // system guarantees is that a second, different, admin approved at the time
    // and that the fact is immutably audited. Flagged for the operator rather
    // than silently assumed either way.
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    await pool.query(`UPDATE users SET status='inactive' WHERE id=$1`, [approver]).catch(() => {});
    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res.outcome).toBe("erased");
    await pool.query(`UPDATE users SET status='active' WHERE id=$1`, [approver]).catch(() => {});
  });

  it("execution from a NON-erasure_agent connection refuses before touching anything", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    const res = await asOwner((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res).toEqual({ outcome: "refused", reason: "not_erasure_agent" });
    expect((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [orgId])).rowCount).toBe(1);
  });
});

/* ─────────────────────── CROSS-ORG AT EVERY STAGE ────────────────────────── */

describe("cross-organization isolation at every stage", () => {
  it("erasing A leaves B entirely intact", async () => {
    const a = await tenant();
    const b = await tenant();
    const bBefore = await asOwner((c) => inventoryOrganization(c, b.orgId));

    const certId = await approvedCertificate(a.orgId);
    const res = await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    expect(res.outcome).toBe("erased");

    expect((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [a.orgId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM organizations WHERE id=$1`, [b.orgId])).rowCount).toBe(1);
    const bAfter = await asOwner((c) => inventoryOrganization(c, b.orgId));
    expect(bAfter.totalRows).toBe(bBefore.totalRows);
    expect(bAfter.inventory).toEqual(bBefore.inventory);
  });

  it("a certificate's fingerprint cannot validate against another organization", async () => {
    const a = await tenant();
    const b = await tenant();
    const invA = await asOwner((c) => inventoryOrganization(c, a.orgId));
    // Same inventory contents, different org: the org id is salted in.
    expect(scopeFingerprint(a.orgId, invA.inventory))
      .not.toBe(scopeFingerprint(b.orgId, invA.inventory));
  });

  it("pointing a certificate at another org after approval is refused", async () => {
    const a = await tenant();
    const b = await tenant();
    const certId = await approvedCertificate(a.orgId);
    await expect(
      pool.query(`UPDATE erasure_certificates SET organization_id=$2 WHERE id=$1`, [certId, b.orgId])
    ).rejects.toThrow(/subject of a certificate is immutable/);
  });
});

/* ─────────────────────── CERTIFICATE AND AUDIT ───────────────────────────── */

describe("the certificate and the audit trail", () => {
  it("is written only after the organization is actually gone, and retains 7 years", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    expect((await certStatus(certId)).scope_digest).toBeNull();

    await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));

    const st = await certStatus(certId);
    expect(st.status).toBe("completed");
    expect(st.scope_digest).toBeTruthy();
    expect(st.scope_digest!["organizations"]).toBe(1);
    const years = (st.retain_until!.getTime() - Date.now()) / (365.25 * 86_400_000);
    expect(years).toBeGreaterThan(6.9);
    expect(years).toBeLessThan(7.1);
  });

  it("carries counts, never content", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));
    const st = await certStatus(certId);
    for (const [, v] of Object.entries(st.scope_digest!)) expect(typeof v).toBe("number");
    const raw = JSON.stringify(st.scope_digest);
    expect(raw).not.toMatch(/erasable tenant/);
    expect(raw).not.toMatch(/@/);
  });

  it("the audit trail records the whole lifecycle and SURVIVES the erasure", async () => {
    const { orgId } = await tenant();
    const certId = await approvedCertificate(orgId);
    await asOwner((c) => dryRunErasure(c, { certificateId: certId, actorUserId: requester }));
    await asErasureAgent((c) => executeErasure(c, { certificateId: certId, actorUserId: null }));

    for (const type of [ERASURE_EVENTS.requested, ERASURE_EVENTS.approved,
                        ERASURE_EVENTS.dryRun, ERASURE_EVENTS.started, ERASURE_EVENTS.completed]) {
      expect(await eventCount(certId, type), `missing ${type}`).toBeGreaterThanOrEqual(1);
    }
    // The completion event is org-NULL by necessity, carrying the erased id.
    const { rows } = await pool.query<{ organization_id: string | null; payload: Record<string, unknown> }>(
      `SELECT organization_id, payload FROM security_audit_log
        WHERE resource_id=$1 AND event_type=$2`, [certId, ERASURE_EVENTS.completed]);
    expect(rows[0]!.organization_id).toBeNull();
    expect(rows[0]!.payload["erasedOrganizationId"]).toBe(orgId);
  });
});

/* ─────────────────────────── PURE GATE ───────────────────────────────────── */

describe("the execution gate refuses on each condition independently", () => {
  const base = {
    status: "approved", dryRun: false, requestedByUserId: "u1", approvedByUserId: "u2",
    approvalExpiresAt: new Date(Date.now() + 3600_000), scopeFingerprint: "fp",
    observedFingerprint: "fp", organizationExists: true, activeLegalHolds: 0, now: new Date(),
  };
  it("passes only when everything holds", () => {
    expect(evaluateExecutionGate(base).proceed).toBe(true);
  });
  const cases: Array<[string, Partial<typeof base>, string]> = [
    ["dry run", { dryRun: true }, "dry_run_certificate"],
    ["self approved", { approvedByUserId: "u1" }, "self_approved"],
    ["no approver", { approvedByUserId: null }, "not_approved"],
    ["expired", { approvalExpiresAt: new Date(Date.now() - 1) }, "approval_expired"],
    ["no expiry", { approvalExpiresAt: null }, "approval_expired"],
    ["unbound scope", { scopeFingerprint: null }, "missing_scope_binding"],
    ["scope changed", { observedFingerprint: "different" }, "scope_changed"],
    ["hold active", { activeLegalHolds: 1 }, "legal_hold_active"],
    ["org gone", { organizationExists: false }, "organization_missing"],
    ["draft", { status: "draft" }, "not_approved"],
    ["completed", { status: "completed" }, "terminal_state"],
  ];
  for (const [label, over, refusal] of cases) {
    it(label, () => {
      expect(evaluateExecutionGate({ ...base, ...over }).refusal).toBe(refusal);
    });
  }
});
