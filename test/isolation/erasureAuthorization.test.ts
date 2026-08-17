/**
 * erasureAuthorization.test.ts — E-2 Increment 2: the credential-gated
 * exception, proven to fail closed in every direction.
 *
 * The permit path is exercised via SET SESSION AUTHORIZATION, which requires
 * SUPERUSER and is available to the test harness but to nothing in production.
 * That is deliberate: it lets the mechanism be proven real WITHOUT a credential
 * for erasure_agent existing anywhere, which is what "inert" has to mean.
 *
 * Nearly every test here asserts a REFUSAL. That balance is the point — a hatch
 * is only as good as the things it declines to open for.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let requester: string;
let approver: string;

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

/** A certificate in the state the guard requires, unless overridden. */
async function certificate(
  orgId: string,
  over: Partial<{ status: string; dryRun: boolean; approved: boolean }> = {}
): Promise<string> {
  const status = over.status ?? "executing";
  const dryRun = over.dryRun ?? false;
  const approved = over.approved ?? status !== "draft";
  // Increment 3 added erasure_certificates_approved_scope: a non-draft
  // certificate MUST carry the scope it was approved for and a deadline. These
  // fixtures therefore supply both — the constraint is doing its job, and an
  // approval that binds nothing is exactly what it exists to reject.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO erasure_certificates
       (organization_id, requested_by_user_id, approved_by_user_id, reason, legal_basis,
        dry_run, status, approved_at, started_at, scope_fingerprint, approval_expires_at)
     VALUES ($1,$2,$3,'isolation probe','gdpr_art17_request',$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      orgId,
      requester,
      approved ? approver : null,
      dryRun,
      status,
      approved ? new Date() : null,
      status === "executing" ? new Date() : null,
      status === "draft" ? null : "fixture-fingerprint",
      status === "draft" ? null : new Date(Date.now() + 86_400_000),
    ]
  );
  return rows[0]!.id;
}

/** An organization carrying one WORM row, so a cascade actually reaches the guard. */
async function erasableOrg(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug)
     VALUES ('erasure probe', 'probe-' || floor(random()*1e12)::text) RETURNING id`
  );
  const org = rows[0]!.id;
  await pool.query(
    `INSERT INTO security_audit_log (organization_id, event_type, resource_type)
     VALUES ($1,'erasure.probe','probe')`,
    [org]
  );
  return org;
}

/**
 * Attempt the REAL erasure statement — DELETE FROM organizations — under a
 * chosen identity and context. Always rolled back. Returns null when it was
 * permitted, or the refusal message.
 *
 * Targeting the organization rather than a WORM row directly is deliberate:
 * erasure_agent holds no privilege on the WORM tables at all, so the only path
 * that reaches the guard as that role is the cascade, which is exactly the path
 * a real erasure takes.
 */
async function attemptErase(opts: {
  becomeErasureAgent?: boolean;
  certId?: string | null;
  orgId?: string | null;
  targetOrgId: string;
}): Promise<string | null> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (opts.certId != null) {
      await c.query(`SELECT set_config('app.erasure_certificate_id', $1, true)`, [opts.certId]);
    }
    if (opts.orgId != null) {
      await c.query(`SELECT set_config('app.erasure_org_id', $1, true)`, [opts.orgId]);
    }
    if (opts.becomeErasureAgent) await c.query("SET SESSION AUTHORIZATION erasure_agent");
    await c.query(`DELETE FROM organizations WHERE id = $1`, [opts.targetOrgId]);
    return null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  pool = new Pool({ connectionString: url, ssl: false });
  requester = (await seedUser(pool, seed.orgA.id)).id;
  approver = (await seedUser(pool, seed.orgA.id)).id;
}, 120_000);

afterAll(async () => {
  await pool.end();
});

/* ───────────────────────────── INERTNESS ─────────────────────────────────── */

describe("the increment ships inert — no credential exists", () => {
  it("erasure_agent exists but CANNOT LOG IN", async () => {
    const { rows } = await pool.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='erasure_agent'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rolcanlogin, "a credential could be used — this is NOT inert").toBe(false);
    expect(rows[0]!.rolsuper).toBe(false);
    expect(rows[0]!.rolbypassrls).toBe(false);
  });

  it("SET ROLE does not become erasure_agent for guard purposes", async () => {
    // session_user, not current_user: the distinction is what stops role
    // assumption from being an escalation path.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE erasure_agent");
      const su = (await c.query<{ session_user: string }>(`SELECT session_user`)).rows[0]!.session_user;
      const cu = (await c.query<{ current_user: string }>(`SELECT current_user`)).rows[0]!.current_user;
      expect(cu).toBe("erasure_agent");
      expect(su).not.toBe("erasure_agent");
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("a full valid context under SET ROLE is still refused", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.erasure_certificate_id', $1, true)`, [cert]);
      await c.query(`SELECT set_config('app.erasure_org_id', $1, true)`, [org]);
      await c.query("SET LOCAL ROLE erasure_agent");
      await expect(c.query(`DELETE FROM organizations WHERE id=$1`, [org])).rejects.toThrow(
        /append-only/
      );
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });
});

/* ──────────────────────────── FAIL CLOSED ────────────────────────────────── */

describe("fail-closed: every missing or wrong condition denies", () => {
  it("missing credential — the OWNER with a perfect context is denied", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org);
    const msg = await attemptErase({ certId: cert, orgId: org, targetOrgId: org });
    expect(msg).toMatch(/security_audit_log is append-only: UPDATE is not permitted/);
  });

  it("correct credential, NO context — denied", async () => {
    const org = await erasableOrg();
    const msg = await attemptErase({ becomeErasureAgent: true, targetOrgId: org });
    expect(msg).toMatch(/append-only/);
  });

  it("correct credential, FORGED context — denied", async () => {
    const org = await erasableOrg();
    for (const [cert, claimed] of [
      ["not-a-uuid", org],
      [ZERO_UUID, org],
      [ZERO_UUID, "also-not-a-uuid"],
      ["", ""],
    ] as Array<[string, string]>) {
      const msg = await attemptErase({
        becomeErasureAgent: true,
        certId: cert,
        orgId: claimed,
        targetOrgId: org,
      });
      expect(msg, `cert=${cert} org=${claimed} was permitted`).toBeTruthy();
    }
  });

  it("certificate exists but is only APPROVED, not executing — denied", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org, { status: "approved" });
    const msg = await attemptErase({
      becomeErasureAgent: true, certId: cert, orgId: org, targetOrgId: org,
    });
    expect(msg).toMatch(/append-only/);
  });

  it("a DRY-RUN certificate never permits a mutation", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org, { dryRun: true });
    const msg = await attemptErase({
      becomeErasureAgent: true, certId: cert, orgId: org, targetOrgId: org,
    });
    expect(msg).toMatch(/append-only/);
  });

  it("TRUNCATE is never permitted, even with a perfect certificate AND the privilege", async () => {
    // erasure_agent is granted no TRUNCATE anywhere, so a plain attempt fails
    // on privilege and would prove nothing about the guard. The grant is made
    // INSIDE the transaction (GRANT is transactional) and rolled back, so the
    // refusal that surfaces is the guard's own.
    const cert = await certificate(seed.orgA.id);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("GRANT TRUNCATE ON security_audit_log TO erasure_agent");
      await c.query(`SELECT set_config('app.erasure_certificate_id', $1, true)`, [cert]);
      await c.query(`SELECT set_config('app.erasure_org_id', $1, true)`, [seed.orgA.id]);
      await c.query("SET SESSION AUTHORIZATION erasure_agent");
      await expect(c.query(`TRUNCATE security_audit_log`)).rejects.toThrow(/append-only/);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("erasure_agent can APPEND to the audit log but never read it", async () => {
    const { rows } = await pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee='erasure_agent' AND table_name='security_audit_log'
        ORDER BY privilege_type`
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(["INSERT"]);
  });

  it("erasure_agent holds NO readable privilege on the WORM tables — it can destroy a tenant, not read one", async () => {
    const { rows } = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee='erasure_agent'
          AND table_name IN ('finding_lifecycle_events','risk_lifecycle_events',
                             'applicability_assessments','applicability_evidence',
                             'applicability_affected_entities','finding_risk_acceptances','retention_policies')
        ORDER BY table_name, privilege_type`
    );
    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([]);
  });

  it("its entire capability is the erasure root plus its own certificate", async () => {
    const { rows } = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee='erasure_agent' ORDER BY table_name, privilege_type`
    );
    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`).sort()).toEqual([
      "erasure_certificates:INSERT",
      "erasure_certificates:SELECT",
      "erasure_certificates:UPDATE",
      "legal_holds:SELECT",
      "organizations:DELETE",
      "organizations:SELECT",
      // Increment 3: append its own audit events inside the destructive
      // transaction. INSERT only — no SELECT, so it still cannot read the log.
      "security_audit_log:INSERT",
    ]);
  });
});

/* ─────────────────────────── CROSS-ORG ISOLATION ─────────────────────────── */

describe("cross-organization: a certificate for A can never touch B", () => {
  it("a certificate for A cannot erase B, even asserting A's own org id", async () => {
    const orgA = await erasableOrg();
    const orgB = await erasableOrg();
    const certA = await certificate(orgA);
    const msg = await attemptErase({
      becomeErasureAgent: true, certId: certA, orgId: orgA, targetOrgId: orgB,
    });
    expect(msg).toMatch(/append-only/);
    const still = await pool.query(`SELECT id FROM organizations WHERE id=$1`, [orgB]);
    expect(still.rows).toHaveLength(1);
  });

  it("claiming org B with a certificate issued for org A is denied", async () => {
    const orgA = await erasableOrg();
    const orgB = await erasableOrg();
    const certA = await certificate(orgA);
    const msg = await attemptErase({
      becomeErasureAgent: true, certId: certA, orgId: orgB, targetOrgId: orgB,
    });
    expect(msg).toMatch(/append-only/);
  });
});

/* ───────────────────────── LEGAL HOLD DOMINANCE ──────────────────────────── */

describe("E-1 legal hold outranks a fully authorized erasure", () => {
  it("an active hold on the org denies the certified erasure", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org);
    const hold = await pool.query<{ id: string }>(
      `INSERT INTO legal_holds (organization_id, scope_type, reason, placed_by_user_id)
       VALUES ($1,'organization','matter under way',$2) RETURNING id`,
      [org, requester]
    );

    const denied = await attemptErase({
      becomeErasureAgent: true, certId: cert, orgId: org, targetOrgId: org,
    });
    expect(denied).toMatch(/append-only/);

    // Released, the same erasure proceeds — proving the hold was the reason.
    await pool.query(
      `UPDATE legal_holds SET status='released', released_by_user_id=$2,
              released_at=now(), release_reason='closed' WHERE id=$1`,
      [hold.rows[0]!.id, approver]
    );
    const permitted = await attemptErase({
      becomeErasureAgent: true, certId: cert, orgId: org, targetOrgId: org,
    });
    expect(permitted).toBeNull();
  });
});

/* ─────────────────────── THE PERMIT PATH IS REAL ─────────────────────────── */

describe("with every condition met, the erasure is permitted", () => {
  it("erases the tenant — and only with every condition together", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org);
    const msg = await attemptErase({
      becomeErasureAgent: true, certId: cert, orgId: org, targetOrgId: org,
    });
    expect(msg).toBeNull();
  });

  it("the SET NULL cascade path (an UPDATE, not a DELETE) is permitted too", async () => {
    // security_audit_log.organization_id is ON DELETE SET NULL, so erasing an
    // org arrives at the guard as an UPDATE whose NEW org is already NULL. The
    // guard reads OLD, which is the only reason this works — and the reason
    // E-2 discovery insisted the exception cover UPDATE as well as DELETE.
    const org = await erasableOrg();
    const cert = await certificate(org);
    expect(await attemptErase({
      becomeErasureAgent: true, certId: cert, orgId: org, targetOrgId: org,
    })).toBeNull();
  });
});

/* ──────────────────────── CERTIFICATE MINIMALITY ─────────────────────────── */

describe("the certificate proves erasure without preserving what was erased", () => {
  it("carries no column that could hold customer content", async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='erasure_certificates'
        ORDER BY ordinal_position`
    );
    const names = rows.map((r) => r.column_name);
    for (const forbidden of ["name", "email", "content", "title", "payload", "data", "snapshot", "backup"]) {
      expect(names.filter((n) => n === forbidden), `column '${forbidden}' would retain erased content`).toEqual([]);
    }
    // The org's name is kept only as a digest, never in the clear.
    expect(names).toContain("organization_name_digest");
    expect(names).not.toContain("organization_name");
  });

  it("has NO foreign key to organizations or users — it must outlive its subject", async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.referential_constraints rc
         JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'erasure_certificates'`
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("survives the erasure of the organization it certifies", async () => {
    const org = await erasableOrg();
    const cert = await certificate(org);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.erasure_certificate_id', $1, true)`, [cert]);
      await c.query(`SELECT set_config('app.erasure_org_id', $1, true)`, [org]);
      await c.query("SET SESSION AUTHORIZATION erasure_agent");
      await c.query(`DELETE FROM organizations WHERE id=$1`, [org]);
      await c.query("RESET SESSION AUTHORIZATION");
      const left = await c.query(`SELECT id FROM erasure_certificates WHERE id=$1`, [cert]);
      expect(left.rows).toHaveLength(1);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("refuses self-approval at the database level", async () => {
    await expect(
      pool.query(
        // Scope binding supplied so the TWO-PERSON constraint is the one under
        // test rather than the scope constraint firing first.
        `INSERT INTO erasure_certificates
           (organization_id, requested_by_user_id, approved_by_user_id, reason, legal_basis,
            dry_run, status, approved_at, scope_fingerprint, approval_expires_at)
         VALUES ($1,$2,$2,'self','gdpr_art17_request',false,'approved',now(),'fp',now()+interval '1 day')`,
        [seed.orgA.id, requester]
      )
    ).rejects.toThrow(/erasure_certificates_two_person/);
  });

  it("freezes the subject of a certificate once written", async () => {
    const cert = await certificate(seed.orgA.id, { status: "approved" });
    await expect(
      pool.query(`UPDATE erasure_certificates SET organization_id=$2 WHERE id=$1`, [cert, seed.orgB.id])
    ).rejects.toThrow(/subject of a certificate is immutable/);
    await expect(
      pool.query(`UPDATE erasure_certificates SET dry_run=true WHERE id=$1`, [cert])
    ).rejects.toThrow(/subject of a certificate is immutable/);
  });

  it("cannot be deleted or truncated", async () => {
    const cert = await certificate(seed.orgA.id, { status: "approved" });
    await expect(pool.query(`DELETE FROM erasure_certificates WHERE id=$1`, [cert])).rejects.toThrow(
      /append-only \(certificate\)/
    );
    await expect(pool.query(`TRUNCATE erasure_certificates`)).rejects.toThrow(
      /append-only \(certificate\)/
    );
  });
});
