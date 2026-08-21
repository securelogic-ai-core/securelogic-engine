/**
 * riskExceptionRls.test.ts — the exception lifecycle against real Postgres
 * (SL-EXC-1).
 *
 * The unit suite proves the shared predicates carry the discriminator. This
 * file proves the CONSEQUENCES against the actual schema — the WORM trigger,
 * the uniqueness rules, and above all the assertions the audit demanded:
 *
 *   approving an exception must not close the finding, must not change its
 *   severity, and must not touch its original remediation due date.
 *
 * Those three are single statements here, and they are the whole package.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let userA: string;
let approverA: string;

const ORIGINAL_DUE = "2026-09-20";

async function seedFinding(orgId: string, over: Record<string, unknown> = {}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, title, severity, description, status, source_type, due_date)
     VALUES ($1, $2, 'Critical', 'exception harness', 'open', 'manual', $3::date)
     RETURNING id`,
    [orgId, (over.title as string) ?? "Unpatched internet-facing host", over.due ?? ORIGINAL_DUE],
  );
  return r.rows[0]!.id;
}

async function seedUser(orgId: string, email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, role, email_verified)
     VALUES ($1, $2, 'Harness User', 'admin', TRUE) RETURNING id`,
    [orgId, email],
  );
  return r.rows[0]!.id;
}

async function raise(
  orgId: string, findingId: string, kind: "acceptance" | "exception",
  over: Record<string, unknown> = {},
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO finding_risk_acceptances
       (organization_id, finding_id, state, kind, owner_user_id, rationale,
        requested_by_user_id, expires_at, compensating_control, sla_due_date_at_request)
     VALUES ($1, $2, 'proposed', $3, $4, $5, $4, $6::date, $7, $8::date)
     RETURNING id`,
    [orgId, findingId, kind, over.owner ?? userA,
     over.rationale ?? "Vendor patch not available until Q4",
     over.expires ?? "2026-10-15",
     over.compensating ?? "WAF virtual patch + daily log review",
     over.sla ?? ORIGINAL_DUE],
  );
  return r.rows[0]!.id;
}

async function approve(id: string, orgId: string): Promise<void> {
  await pool.query(
    `UPDATE finding_risk_acceptances
        SET state = 'approved', approver_user_id = $3, approved_at = NOW(),
            decision_rationale = 'Compensating control accepted by the CISO'
      WHERE id = $1 AND organization_id = $2`,
    [id, orgId, approverA],
  );
}

/** The binding predicate, verbatim from riskAcceptanceContract.ts. */
async function isBinding(id: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(
    `SELECT (a.kind = 'acceptance'
             AND a.state = 'approved'
             AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)) AS ok
       FROM finding_risk_acceptances a WHERE a.id = $1`, [id]);
  return r.rows[0]!.ok;
}

async function inRolledBackTx<T>(fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function asOrg<T>(orgId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
  userA = await seedUser(seed.orgA.id, "owner-exc@example.com");
  approverA = await seedUser(seed.orgA.id, "approver-exc@example.com");
});

afterAll(async () => {
  await pool?.end();
});

/* ── 1–3. The three assertions the audit demanded ────────────────────────── */

describe("approving an exception changes nothing about the finding", () => {
  it("does NOT make it binding — so nothing can close the finding", async () => {
    await inRolledBackTx(async () => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");
      await approve(e, seed.orgA.id);

      expect(await isBinding(e)).toBe(false);
    });
  });

  it("an ACCEPTANCE on the same shape IS binding — the discriminator is doing the work", async () => {
    await inRolledBackTx(async () => {
      const f = await seedFinding(seed.orgA.id, { title: "Acceptance control" });
      const a = await raise(seed.orgA.id, f, "acceptance");
      await approve(a, seed.orgA.id);

      expect(await isBinding(a)).toBe(true);
    });
  });

  it("does NOT change the finding's severity", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");
      await approve(e, seed.orgA.id);

      const r = await c.query<{ severity: string }>(
        `SELECT severity FROM findings WHERE id = $1`, [f]);
      expect(r.rows[0]!.severity).toBe("Critical");
    });
  });

  it("does NOT rewrite the original remediation due date", async () => {
    // The heart of it: an auditor must be able to see BOTH that the SLA was
    // missed AND that the exposure was authorised. Overwriting due_date would
    // destroy the first fact in order to record the second.
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception", { expires: "2026-10-15" });
      await approve(e, seed.orgA.id);

      const r = await c.query<{ due_date: string }>(
        `SELECT due_date::text AS due_date FROM findings WHERE id = $1`, [f]);
      expect(r.rows[0]!.due_date).toBe(ORIGINAL_DUE);
    });
  });

  it("preserves the original due date ON the exception, so both dates are readable", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception", { expires: "2026-10-15" });

      const r = await c.query<{ sla: string; exp: string }>(
        `SELECT sla_due_date_at_request::text AS sla, expires_at::text AS exp
           FROM finding_risk_acceptances WHERE id = $1`, [e]);

      expect(r.rows[0]!.sla).toBe(ORIGINAL_DUE);   // what was required
      expect(r.rows[0]!.exp).toBe("2026-10-15");   // what was authorised
    });
  });

  it("records the compensating control", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");

      const r = await c.query<{ cc: string }>(
        `SELECT compensating_control AS cc FROM finding_risk_acceptances WHERE id = $1`, [e]);
      expect(r.rows[0]!.cc).toMatch(/WAF virtual patch/);
    });
  });
});

/* ── 4. Rejection leaves the lifecycle intact ───────────────────────────── */

describe("a rejected exception leaves everything alone", () => {
  it("is not binding and not in force", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");
      await c.query(`UPDATE finding_risk_acceptances SET state='rejected' WHERE id=$1`, [e]);

      const r = await c.query<{ binding: boolean; inforce: boolean }>(
        `SELECT (a.kind='acceptance' AND a.state='approved') AS binding,
                (a.kind='exception'  AND a.state='approved') AS inforce
           FROM finding_risk_acceptances a WHERE a.id = $1`, [e]);
      expect(r.rows[0]).toMatchObject({ binding: false, inforce: false });
    });
  });
});

/* ── 5. An expired exception is not "currently approved" ─────────────────── */

describe("expiry is truthful without waiting for a sweep", () => {
  it("a past expiry date stops the exception being in force, even while state='approved'", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception", { expires: "2020-01-01" });
      await approve(e, seed.orgA.id);

      const r = await c.query<{ inforce: boolean }>(
        `SELECT (a.kind='exception' AND a.state='approved'
                 AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)) AS inforce
           FROM finding_risk_acceptances a WHERE a.id = $1`, [e]);

      expect(r.rows[0]!.inforce).toBe(false);
    });
  });

  it("the state can then advance to expired", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception", { expires: "2020-01-01" });
      await approve(e, seed.orgA.id);

      await c.query(`UPDATE finding_risk_acceptances SET state='expired' WHERE id=$1`, [e]);
      const r = await c.query<{ state: string }>(
        `SELECT state FROM finding_risk_acceptances WHERE id=$1`, [e]);
      expect(r.rows[0]!.state).toBe("expired");
    });
  });
});

/* ── The record cannot be rewritten after the fact ───────────────────────── */

describe("WORM covers the new decision content", () => {
  it("kind is immutable — an exception can never become an acceptance", async () => {
    // Otherwise an approved exception could be flipped and retroactively close
    // its finding, under an approver who signed something else.
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");

      await expect(
        c.query(`UPDATE finding_risk_acceptances SET kind='acceptance' WHERE id=$1`, [e]),
      ).rejects.toThrow(/kind is immutable/i);
    });
  });

  it("the compensating control freezes once approved", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");
      await approve(e, seed.orgA.id);

      await expect(
        c.query(`UPDATE finding_risk_acceptances SET compensating_control='rewritten' WHERE id=$1`, [e]),
      ).rejects.toThrow(/immutable \(WORM\)/i);
    });
  });

  it("the frozen SLA date cannot be edited after approval", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");
      await approve(e, seed.orgA.id);

      await expect(
        c.query(`UPDATE finding_risk_acceptances SET sla_due_date_at_request='2027-01-01' WHERE id=$1`, [e]),
      ).rejects.toThrow(/immutable \(WORM\)/i);
    });
  });

  it("separation of duties still holds", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      const e = await raise(seed.orgA.id, f, "exception");

      await expect(
        c.query(
          `UPDATE finding_risk_acceptances
              SET state='approved', approver_user_id = requested_by_user_id, approved_at = NOW()
            WHERE id = $1`, [e]),
      ).rejects.toThrow(/violates check constraint/i);
    });
  });
});

/* ── One live record per KIND ────────────────────────────────────────────── */

describe("a finding may hold one live record of each kind", () => {
  it("refuses a second live exception", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      await raise(seed.orgA.id, f, "exception");

      await expect(
        c.query(
          `INSERT INTO finding_risk_acceptances
             (organization_id, finding_id, state, kind, owner_user_id, rationale, requested_by_user_id, expires_at)
           VALUES ($1,$2,'proposed','exception',$3,'second','${"".padEnd(0)}'||$3,'2026-12-01')`,
          [seed.orgA.id, f, userA]),
      ).rejects.toThrow();
    });
  });

  it("allows an exception and an acceptance to coexist — different decisions", async () => {
    // Nothing should force a customer to withdraw one to record the other.
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id);
      await raise(seed.orgA.id, f, "exception");
      await raise(seed.orgA.id, f, "acceptance");

      const r = await c.query(`SELECT kind FROM finding_risk_acceptances WHERE finding_id = $1`, [f]);
      expect(r.rowCount).toBe(2);
    });
  });
});

/* ── 6. Tenant isolation ─────────────────────────────────────────────────── */

describe("tenant isolation", () => {
  it("tenant B cannot read tenant A's exception", async () => {
    const f = await seedFinding(seed.orgA.id, { title: "Isolation subject" });
    const e = await raise(seed.orgA.id, f, "exception");

    const rows = await asOrg(seed.orgB.id, async (c) =>
      (await c.query(`SELECT id FROM finding_risk_acceptances WHERE id = $1`, [e])).rows);

    expect(rows).toHaveLength(0);
  });

  it("tenant B cannot APPROVE tenant A's exception", async () => {
    const f = await seedFinding(seed.orgA.id, { title: "Isolation approve" });
    const e = await raise(seed.orgA.id, f, "exception");

    const res = await asOrg(seed.orgB.id, async (c) =>
      c.query(`UPDATE finding_risk_acceptances SET state='approved' WHERE id=$1`, [e]));

    // RLS makes the row invisible, so the UPDATE matches nothing rather than
    // erroring — the decision is untouched either way.
    expect(res.rowCount).toBe(0);
  });

  it("tenant B cannot forge an exception stamped with tenant A's org", async () => {
    const f = await seedFinding(seed.orgA.id, { title: "Isolation forge" });

    await expect(
      asOrg(seed.orgB.id, async (c) =>
        c.query(
          `INSERT INTO finding_risk_acceptances
             (organization_id, finding_id, state, kind, rationale, expires_at)
           VALUES ($1,$2,'proposed','exception','forged','2026-12-01')`,
          [seed.orgA.id, f])),
    ).rejects.toThrow(/row-level security/i);
  });
});

/* ── 7. The Finding ↔ Risk relationship survives ─────────────────────────── */

describe("exception actions do not disturb the Risk Register relationship", () => {
  it("an approved exception leaves the finding's risk link in place", async () => {
    await inRolledBackTx(async (c) => {
      const f = await seedFinding(seed.orgA.id, { title: "Linked finding" });
      const r = await c.query<{ id: string }>(
        `INSERT INTO risks (organization_id, title, domain, likelihood, impact, risk_rating)
         VALUES ($1,'Internet-facing exposure','cyber','likely','High','High') RETURNING id`,
        [seed.orgA.id]);
      const riskId = r.rows[0]!.id;
      await c.query(
        `INSERT INTO finding_risks (organization_id, finding_id, risk_id, link_type)
         VALUES ($1,$2,$3,'linked')`, [seed.orgA.id, f, riskId]);

      const e = await raise(seed.orgA.id, f, "exception");
      await approve(e, seed.orgA.id);

      const link = await c.query(
        `SELECT 1 FROM finding_risks WHERE finding_id = $1 AND risk_id = $2`, [f, riskId]);
      expect(link.rowCount).toBe(1);

      const risk = await c.query<{ status: string }>(
        `SELECT status FROM risks WHERE id = $1`, [riskId]);
      expect(risk.rows[0]!.status).toBe("open");
    });
  });
});
