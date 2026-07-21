/**
 * orchestrationPlaybookStore.ts — ERIP E6b: tenant-scoped CRUD + instantiation
 * for orchestration_playbooks (20260819). A playbook is an ordered set of
 * proposal templates; running it CREATES proposals (status 'proposed') — each
 * still requires a different human to approve before its executor runs
 * (ERIP-AD-24/25). Runs on the tenant `pg` proxy with explicit org predicates.
 */

import { pg } from "../infra/postgres.js";
import { validatePlaybookSteps, type PlaybookStep } from "./orchestrationPolicy.js";

export interface PlaybookRow {
  id: string;
  organization_id: string;
  name: string;
  steps: PlaybookStep[];
  schedule_interval_minutes: number | null;
  next_run_at: string | null;
  enabled: boolean;
  last_run_at: string | null;
}

const COLS =
  "id, organization_id, name, steps, schedule_interval_minutes, next_run_at, enabled, last_run_at";

export async function getPlaybook(orgId: string, id: string): Promise<PlaybookRow | null> {
  const r = await pg.query(
    `SELECT ${COLS} FROM orchestration_playbooks WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id]
  );
  return (r.rows[0] as PlaybookRow | undefined) ?? null;
}

export async function listPlaybooks(orgId: string): Promise<PlaybookRow[]> {
  const r = await pg.query(
    `SELECT ${COLS} FROM orchestration_playbooks WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [orgId]
  );
  return r.rows as PlaybookRow[];
}

export async function createPlaybook(
  orgId: string,
  name: string,
  steps: PlaybookStep[],
  scheduleIntervalMinutes: number | null,
  enabled: boolean,
  createdByUserId: string | null
): Promise<PlaybookRow> {
  const r = await pg.query(
    `INSERT INTO orchestration_playbooks
       (organization_id, name, steps, schedule_interval_minutes, enabled, created_by_user_id)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING ${COLS}`,
    [orgId, name, JSON.stringify(steps), scheduleIntervalMinutes, enabled, createdByUserId]
  );
  return r.rows[0] as PlaybookRow;
}

export async function updatePlaybook(
  orgId: string,
  id: string,
  fields: { enabled?: boolean | undefined; scheduleIntervalMinutes?: number | null | undefined }
): Promise<PlaybookRow | null> {
  const r = await pg.query(
    `UPDATE orchestration_playbooks
        SET enabled = COALESCE($3, enabled),
            schedule_interval_minutes = CASE WHEN $4 THEN $5 ELSE schedule_interval_minutes END,
            next_run_at = CASE WHEN $4 THEN NULL ELSE next_run_at END,
            updated_at = now()
      WHERE organization_id = $1 AND id = $2
      RETURNING ${COLS}`,
    [
      orgId,
      id,
      fields.enabled ?? null,
      fields.scheduleIntervalMinutes !== undefined,
      fields.scheduleIntervalMinutes ?? null
    ]
  );
  return (r.rows[0] as PlaybookRow | undefined) ?? null;
}

export async function deletePlaybook(orgId: string, id: string): Promise<boolean> {
  const r = await pg.query(`DELETE FROM orchestration_playbooks WHERE organization_id = $1 AND id = $2`, [orgId, id]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Instantiate a playbook: create one 'proposed' orchestration_proposals row per
 * step (each still needs human approval), and advance last_run_at (+ next_run_at
 * when scheduled). Returns the created proposal ids. Steps are re-validated
 * defensively before insert. Runs inside the caller's tenant transaction.
 */
export async function runPlaybook(
  orgId: string,
  playbook: PlaybookRow,
  proposedByUserId: string | null
): Promise<{ proposal_ids: string[]; skipped: number }> {
  const validated = validatePlaybookSteps(playbook.steps);
  const steps = "steps" in validated ? validated.steps : [];
  const ids: string[] = [];
  for (const step of steps) {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO orchestration_proposals (organization_id, proposal_type, title, payload, proposed_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
      [orgId, step.proposal_type, step.title, JSON.stringify(step.payload), proposedByUserId]
    );
    ids.push(r.rows[0]!.id);
  }

  const advanceScheduled = playbook.schedule_interval_minutes !== null;
  await pg.query(
    `UPDATE orchestration_playbooks
        SET last_run_at = now(),
            next_run_at = CASE WHEN $3 THEN now() + make_interval(mins => $4::int) ELSE next_run_at END,
            updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, playbook.id, advanceScheduled, playbook.schedule_interval_minutes ?? 0]
  );

  return { proposal_ids: ids, skipped: playbook.steps.length - steps.length };
}
