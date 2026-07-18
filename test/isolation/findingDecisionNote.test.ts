/**
 * findingDecisionNote.test.ts — the decision rationale on the governance write.
 *
 * PATCH /api/findings/:id accepts an optional `decision_note` alongside a
 * `decision_state` transition (Governance Decision panel). The note must land on
 * the SAME trail as the decision itself: the finding_lifecycle_events row's
 * `comment` (column existed since 20260901, never written by this route before)
 * and the decision audit payload. Real app over real Postgres:
 *
 *   1. a note rides the transition onto the lifecycle event + audit payload;
 *   2. a malformed note is refused up front (400) and NOTHING is written;
 *   3. cross-tenant: an org-A caller cannot decide (or annotate) an org-B
 *      finding — 404, no lifecycle event, no note anywhere.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

const DW_FLAG = "SECURELOGIC_DECISION_WORKSPACE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;
let prevDw: string | undefined;

async function seedFinding(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'decision-note seed', 'manual', 'open')
     RETURNING id`,
    [orgId, title]
  );
  return r.rows[0]!.id;
}

async function lifecycleEvents(
  findingId: string
): Promise<Array<{ to_state: string; comment: string | null }>> {
  const r = await pool.query<{ to_state: string; comment: string | null }>(
    `SELECT to_state, comment FROM finding_lifecycle_events
      WHERE finding_id = $1 AND axis = 'decision'
      ORDER BY created_at ASC, id ASC`,
    [findingId]
  );
  return r.rows;
}

const patch = (id: string, key: string, body: object) =>
  request(app).patch(`/api/findings/${id}`).set("X-Api-Key", key).send(body);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevDw = process.env[DW_FLAG];
  process.env[DW_FLAG] = "true"; // the decision axis is flag-gated
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the decision-note test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  if (prevDw === undefined) delete process.env[DW_FLAG];
  else process.env[DW_FLAG] = prevDw;
  await pool?.end();
});

describe("decision_note rides the governance transition onto its audit trail", () => {
  it("persists the note as the lifecycle event comment AND in the audit payload", async () => {
    const id = await seedFinding(seed.orgA.id, "note-on-transition");

    const res = await patch(id, seed.orgA.apiKey, {
      decision_state: "mitigating",
      decision_note: "  Plan accepted after vendor confirmed the patch window.  ",
    });
    expect(res.status).toBe(200);

    const events = await lifecycleEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.to_state).toBe("mitigating");
    // Trimmed, verbatim.
    expect(events[0]!.comment).toBe("Plan accepted after vendor confirmed the patch window.");

    // writeAuditEvent is fire-and-forget (not awaited in the response path) —
    // poll briefly for the projected audit row rather than racing it.
    let auditNote: string | undefined;
    for (let i = 0; i < 20 && auditNote === undefined; i++) {
      const audit = await pool.query<{ payload: { note?: string } }>(
        `SELECT payload FROM security_audit_log
          WHERE resource_id = $1 AND event_type = 'finding.decision.mitigating'`,
        [id]
      );
      auditNote = audit.rows[0]?.payload?.note;
      if (auditNote === undefined) await new Promise((r) => setTimeout(r, 100));
    }
    expect(auditNote).toBe("Plan accepted after vendor confirmed the patch window.");
  });

  it("a transition WITHOUT a note keeps a null comment (note never fabricated)", async () => {
    const id = await seedFinding(seed.orgA.id, "no-note-transition");

    const res = await patch(id, seed.orgA.apiKey, { decision_state: "mitigating" });
    expect(res.status).toBe(200);

    const events = await lifecycleEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.comment).toBeNull();
  });

  it("refuses a malformed note up front — 400, and NO transition is written", async () => {
    const id = await seedFinding(seed.orgA.id, "bad-note-refused");

    for (const bad of [12345, "", "   ", "x".repeat(2001)]) {
      const res = await patch(id, seed.orgA.apiKey, {
        decision_state: "mitigating",
        decision_note: bad,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_decision_note");
    }

    // The refusal left the finding untouched: no lifecycle event, state unchanged.
    expect(await lifecycleEvents(id)).toHaveLength(0);
    const r = await pool.query<{ decision_state: string }>(
      `SELECT decision_state FROM findings WHERE id = $1`,
      [id]
    );
    expect(r.rows[0]!.decision_state).toBe("needs_review");
  });
});

describe("cross-tenant: a decision (and its note) never crosses an org boundary", () => {
  it("org-A key PATCHing an org-B finding is a 404 with nothing written", async () => {
    const id = await seedFinding(seed.orgB.id, "other-org-finding");

    const res = await patch(id, seed.orgA.apiKey, {
      decision_state: "mitigating",
      decision_note: "cross-tenant note that must never land",
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("finding_not_found");

    // Nothing was decided, nothing was annotated.
    expect(await lifecycleEvents(id)).toHaveLength(0);
    const r = await pool.query<{ decision_state: string }>(
      `SELECT decision_state FROM findings WHERE id = $1`,
      [id]
    );
    expect(r.rows[0]!.decision_state).toBe("needs_review");
    const note = await pool.query(
      `SELECT 1 FROM finding_lifecycle_events WHERE comment = 'cross-tenant note that must never land'`
    );
    expect(note.rowCount).toBe(0);
  });
});
