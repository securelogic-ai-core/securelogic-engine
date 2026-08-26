/**
 * assignments.ts — who is expected to answer what (VA-D1).
 *
 * The rules live here once, for the same reason VA-P1's participants.ts does:
 * both the vendor portal and the customer API reach this, through disjoint
 * authentication worlds, and two copies of "assign a question" is how one of
 * them eventually forgets an engagement predicate.
 *
 * ── Two facts that must never merge ────────────────────────────────────────
 *
 *   ASSIGNED TO   responsibility  — this module
 *   ANSWERED BY   authorship      — requirement_responses.answered_via_invite_id
 *
 * A coordinator answering a question assigned to Susan records an answer by the
 * coordinator and leaves the assignment pointing at Susan. "Susan never did her
 * 18" and "Susan's 18 got done for her" are different situations.
 *
 * ── Completion has ONE definition ──────────────────────────────────────────
 *
 * Derived from `requirement_responses`, never stored. A second `completed` flag
 * would drift from whether the question actually has an answer the moment a
 * reviewer reopens one for clarification, and the drifted copy is always the one
 * somebody reports to a board.
 *
 * ── The ledger is append-only ──────────────────────────────────────────────
 *
 * Reassigning supersedes the current row and inserts the next. Nothing is
 * updated in place except `superseded_at`, so the history of a question's
 * ownership is reconstructable from the table itself and not only from
 * fire-and-forget audit rows.
 */

import { pg } from "../../infra/postgres.js";

export const ASSIGNMENT_ACTIONS = [
  "assigned",
  "reassigned",
  "unassigned",
  "vacated_on_revocation",
] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

export type AssignmentActor =
  | { participantId: string }
  | { userId: string | null };

export type CurrentAssignment = {
  requirement_id: string;
  assigned_to_participant_id: string | null;
  assignment_action: AssignmentAction;
  assignment_source: string;
  assigned_at: string;
  assignee_name: string | null;
};

/**
 * The current assignment of every question in the engagement's issued scope.
 *
 * Driven from the SCOPE, left-joined to assignments — not the other way round.
 * A question nobody has touched has no assignment row at all, and it must still
 * appear as outstanding work: driving from the ledger would make unassigned
 * work invisible, which is precisely the work a coordinator needs to find.
 */
export async function listEngagementAssignments(
  organizationId: string,
  engagementId: string
): Promise<CurrentAssignment[]> {
  const res = await pg.query<CurrentAssignment>(
    `SELECT si.requirement_id,
            a.assigned_to_participant_id,
            COALESCE(a.assignment_action, 'unassigned') AS assignment_action,
            COALESCE(a.assignment_source, 'question')   AS assignment_source,
            a.assigned_at,
            c.full_name AS assignee_name
       FROM vendor_engagement_scope_items si
       LEFT JOIN vendor_engagement_assignments a
              ON a.engagement_id = si.engagement_id
             AND a.organization_id = si.organization_id
             AND a.requirement_id = si.requirement_id
             AND a.superseded_at IS NULL
       LEFT JOIN vendor_engagement_participants p ON p.id = a.assigned_to_participant_id
       LEFT JOIN vendor_contacts c ON c.id = p.contact_id
      WHERE si.engagement_id = $1
        AND si.organization_id = $2
        AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
      ORDER BY si.requirement_id`,
    [organizationId, engagementId]
  );
  return res.rows;
}

export type AssignmentHistoryRow = {
  id: string;
  requirement_id: string;
  assigned_to_participant_id: string | null;
  assignee_name: string | null;
  assignment_action: AssignmentAction;
  assignment_source: string;
  assigned_by_participant_id: string | null;
  assigned_by_user_id: string | null;
  actor_name: string | null;
  assigned_at: string;
  superseded_at: string | null;
};

/** Every act ever performed on one question's ownership, oldest first. */
export async function listAssignmentHistory(
  organizationId: string,
  engagementId: string,
  requirementId: string
): Promise<AssignmentHistoryRow[]> {
  const res = await pg.query<AssignmentHistoryRow>(
    `SELECT a.id, a.requirement_id, a.assigned_to_participant_id,
            assignee.full_name AS assignee_name,
            a.assignment_action, a.assignment_source,
            a.assigned_by_participant_id, a.assigned_by_user_id,
            actor.full_name AS actor_name,
            a.assigned_at, a.superseded_at
       FROM vendor_engagement_assignments a
       LEFT JOIN vendor_engagement_participants ap ON ap.id = a.assigned_to_participant_id
       LEFT JOIN vendor_contacts assignee ON assignee.id = ap.contact_id
       LEFT JOIN vendor_engagement_participants bp ON bp.id = a.assigned_by_participant_id
       LEFT JOIN vendor_contacts actor ON actor.id = bp.contact_id
      WHERE a.organization_id = $1 AND a.engagement_id = $2 AND a.requirement_id = $3
      ORDER BY a.assigned_at ASC, a.created_at ASC`,
    [organizationId, engagementId, requirementId]
  );
  return res.rows;
}

export type AssignFailure =
  | "engagement_not_found"
  | "requirement_not_in_scope"
  | "participant_not_on_engagement"
  | "participant_revoked";

/**
 * Assign, reassign or unassign ONE question.
 *
 * `participantId === null` unassigns. Passing the participant who already owns
 * it is a no-op that still returns ok — re-sending the same instruction should
 * not be an error, and writing a redundant ledger row would make the history
 * harder to read rather than more complete.
 *
 * Must be called inside a tenant transaction; uses the ambient client so it
 * rolls back with its caller.
 */
export async function setAssignment(args: {
  organizationId: string;
  engagementId: string;
  requirementId: string;
  participantId: string | null;
  actor: AssignmentActor;
  source?: "question" | "framework_bulk";
  note?: string | null;
  /** Set when the cause is a revocation rather than a human decision. */
  vacating?: boolean;
}): Promise<
  { ok: true; changed: boolean; action: AssignmentAction } | { ok: false; failure: AssignFailure }
> {
  const { organizationId, engagementId, requirementId, participantId } = args;

  const eng = await pg.query<{ vendor_id: string }>(
    `SELECT vendor_id FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [engagementId, organizationId]
  );
  const vendorId = eng.rows[0]?.vendor_id;
  if (!vendorId) return { ok: false, failure: "engagement_not_found" };

  // Only the FROZEN issued scope can be delegated. Checked here so the caller
  // gets a name for the refusal; the trigger enforces it regardless.
  const scoped = await pg.query(
    `SELECT 1 FROM vendor_engagement_scope_items
      WHERE engagement_id = $1 AND organization_id = $2 AND requirement_id = $3
        AND (source = 'deterministic' OR accepted_at IS NOT NULL)
      LIMIT 1`,
    [engagementId, organizationId, requirementId]
  );
  if ((scoped.rowCount ?? 0) === 0) return { ok: false, failure: "requirement_not_in_scope" };

  if (participantId) {
    // Of THIS engagement — belonging to the same vendor is not enough.
    const target = await pg.query<{ status: string }>(
      `SELECT status FROM vendor_engagement_participants
        WHERE id = $1 AND organization_id = $2 AND engagement_id = $3 LIMIT 1`,
      [participantId, organizationId, engagementId]
    );
    if (target.rowCount === 0) return { ok: false, failure: "participant_not_on_engagement" };
    // Assigning work to somebody who cannot open the questionnaire would be a
    // task that can never be done, silently.
    if (target.rows[0]!.status === "revoked") return { ok: false, failure: "participant_revoked" };
  }

  const current = await pg.query<{ id: string; assigned_to_participant_id: string | null }>(
    `SELECT id, assigned_to_participant_id
       FROM vendor_engagement_assignments
      WHERE organization_id = $1 AND engagement_id = $2 AND requirement_id = $3
        AND superseded_at IS NULL
      LIMIT 1`,
    [organizationId, engagementId, requirementId]
  );
  const existing = current.rows[0] ?? null;

  // Already in the requested state. Say so rather than writing noise.
  if ((existing?.assigned_to_participant_id ?? null) === participantId) {
    return {
      ok: true,
      changed: false,
      action: participantId ? "assigned" : "unassigned",
    };
  }

  const action: AssignmentAction = participantId
    ? existing?.assigned_to_participant_id
      ? "reassigned"
      : "assigned"
    : args.vacating
      ? "vacated_on_revocation"
      : "unassigned";

  if (existing) {
    await pg.query(
      `UPDATE vendor_engagement_assignments SET superseded_at = NOW() WHERE id = $1`,
      [existing.id]
    );
  }

  await pg.query(
    `INSERT INTO vendor_engagement_assignments
       (organization_id, vendor_id, engagement_id, requirement_id,
        assigned_to_participant_id, assigned_by_participant_id, assigned_by_user_id,
        assignment_action, assignment_source, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      organizationId,
      vendorId,
      engagementId,
      requirementId,
      participantId,
      "participantId" in args.actor ? args.actor.participantId : null,
      "userId" in args.actor ? args.actor.userId : null,
      action,
      args.source ?? "question",
      args.note ?? null,
    ]
  );

  return { ok: true, changed: true, action };
}

/**
 * Assign every currently-scoped requirement of ONE FRAMEWORK.
 *
 * The owner ruling's section model: framework_id is the only deterministic
 * grouping this repository has, and a framework action is a BULK ACTION over
 * per-requirement rows — no section object is stored, so a better taxonomy
 * later changes the selection layer and nothing else.
 *
 * Bounded to the engagement's frozen issued scope, so it can never assign a
 * question the vendor was not asked, or one belonging to another engagement.
 */
export async function assignFramework(args: {
  organizationId: string;
  engagementId: string;
  frameworkId: string;
  participantId: string | null;
  actor: AssignmentActor;
}): Promise<
  { ok: true; affected: number; skipped: number } | { ok: false; failure: AssignFailure }
> {
  const targets = await pg.query<{ requirement_id: string }>(
    `SELECT si.requirement_id
       FROM vendor_engagement_scope_items si
       JOIN requirements r ON r.id = si.requirement_id
      WHERE si.engagement_id = $1
        AND si.organization_id = $2
        AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
        AND r.framework_id = $3
      ORDER BY si.requirement_id`,
    [args.engagementId, args.organizationId, args.frameworkId]
  );

  let affected = 0;
  let skipped = 0;
  for (const row of targets.rows) {
    const res = await setAssignment({
      organizationId: args.organizationId,
      engagementId: args.engagementId,
      requirementId: row.requirement_id,
      participantId: args.participantId,
      actor: args.actor,
      source: "framework_bulk",
    });
    // A failure mid-bulk is NOT swallowed: it propagates so the whole tenant
    // transaction rolls back. A partially-applied bulk assignment would leave
    // the coordinator believing a framework was delegated when half of it was.
    if (!res.ok) return { ok: false, failure: res.failure };
    if (res.changed) affected += 1;
    else skipped += 1;
  }
  return { ok: true, affected, skipped };
}

/**
 * Release everything a revoked participant owned.
 *
 * Owner ruling: their outstanding work becomes VISIBLY UNASSIGNED and waits for
 * the coordinator. It is never auto-assigned to another human — the system does
 * not know who should inherit it, and guessing would put work in somebody's
 * queue without anybody deciding that.
 *
 * Their name stays on everything they actually answered; only the forward
 * responsibility is released.
 */
export async function vacateAssignmentsOfParticipant(args: {
  organizationId: string;
  engagementId: string;
  participantId: string;
  actor: AssignmentActor;
}): Promise<{ vacated: number }> {
  const owned = await pg.query<{ requirement_id: string }>(
    `SELECT requirement_id FROM vendor_engagement_assignments
      WHERE organization_id = $1 AND engagement_id = $2
        AND assigned_to_participant_id = $3 AND superseded_at IS NULL`,
    [args.organizationId, args.engagementId, args.participantId]
  );

  for (const row of owned.rows) {
    await setAssignment({
      organizationId: args.organizationId,
      engagementId: args.engagementId,
      requirementId: row.requirement_id,
      participantId: null,
      actor: args.actor,
      vacating: true,
    });
  }
  return { vacated: owned.rowCount ?? 0 };
}

/* =========================================================
   Progress — one definition of complete, derived, never stored
   ========================================================= */

export type ParticipantProgress = {
  participant_id: string;
  full_name: string;
  participant_role: string;
  status: string;
  assigned: number;
  complete: number;
  outstanding: number;
};

export type FrameworkProgress = {
  framework_id: string;
  framework_name: string;
  total: number;
  complete: number;
  assigned: number;
  unassigned: number;
};

export type EngagementProgress = {
  total: number;
  complete: number;
  outstanding: number;
  assigned: number;
  unassigned: number;
  mandatory_total: number;
  mandatory_complete: number;
  by_participant: ParticipantProgress[];
  /**
   * Present only when the engagement genuinely spans MORE THAN ONE framework.
   * Owner ruling: a single-framework assessment must not be dressed up as
   * having sections — one group covering everything is not a section, and
   * showing it as one invites a coordinator to delegate "by section" and find
   * they delegated the entire questionnaire.
   */
  by_framework: FrameworkProgress[] | null;
  framework_grouping_available: boolean;
};

/**
 * The coordinator's board.
 *
 * The denominator is the ENGAGEMENT'S ISSUED SCOPE, and the same denominator is
 * used for the overall figure, the per-framework figures and the per-participant
 * figures. Percentages computed against different denominators are the classic
 * way a progress view lies, so there is exactly one here.
 *
 * "Complete" means the question has a response row with a non-null status, which
 * is the same condition the submit guard uses. No second truth.
 */
export async function engagementProgress(
  organizationId: string,
  engagementId: string
): Promise<EngagementProgress> {
  const totals = await pg.query<{
    total: string;
    complete: string;
    assigned: string;
    mandatory_total: string;
    mandatory_complete: string;
  }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(rr.status)::text AS complete,
            COUNT(a.assigned_to_participant_id)::text AS assigned,
            COUNT(*) FILTER (WHERE si.mandatory)::text AS mandatory_total,
            COUNT(*) FILTER (WHERE si.mandatory AND rr.status IS NOT NULL)::text AS mandatory_complete
       FROM vendor_engagement_scope_items si
       LEFT JOIN requirement_responses rr
              ON rr.requirement_id = si.requirement_id
             AND rr.engagement_id = si.engagement_id
             AND rr.organization_id = si.organization_id
       LEFT JOIN vendor_engagement_assignments a
              ON a.requirement_id = si.requirement_id
             AND a.engagement_id = si.engagement_id
             AND a.organization_id = si.organization_id
             AND a.superseded_at IS NULL
      WHERE si.engagement_id = $1 AND si.organization_id = $2
        AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)`,
    [engagementId, organizationId]
  );
  const t = totals.rows[0]!;
  const total = Number(t.total);
  const complete = Number(t.complete);
  const assigned = Number(t.assigned);

  // Per participant, counting ONLY what is actually assigned to them — a
  // participant's completion must not be measured against the whole
  // questionnaire, which would make everybody look permanently behind.
  const perParticipant = await pg.query<ParticipantProgress>(
    `SELECT p.id AS participant_id, c.full_name, p.participant_role, p.status,
            COUNT(a.id)::int AS assigned,
            COUNT(rr.status)::int AS complete,
            (COUNT(a.id) - COUNT(rr.status))::int AS outstanding
       FROM vendor_engagement_participants p
       JOIN vendor_contacts c ON c.id = p.contact_id
       LEFT JOIN vendor_engagement_assignments a
              ON a.assigned_to_participant_id = p.id
             AND a.superseded_at IS NULL
             AND a.engagement_id = p.engagement_id
       LEFT JOIN requirement_responses rr
              ON rr.requirement_id = a.requirement_id
             AND rr.engagement_id = a.engagement_id
             AND rr.organization_id = a.organization_id
      WHERE p.organization_id = $1 AND p.engagement_id = $2
      GROUP BY p.id, c.full_name, p.participant_role, p.status
      ORDER BY (p.participant_role = 'coordinator') DESC, lower(c.full_name)`,
    [organizationId, engagementId]
  );

  const perFramework = await pg.query<FrameworkProgress>(
    `SELECT f.id AS framework_id, f.name AS framework_name,
            COUNT(*)::int AS total,
            COUNT(rr.status)::int AS complete,
            COUNT(a.assigned_to_participant_id)::int AS assigned,
            (COUNT(*) - COUNT(a.assigned_to_participant_id))::int AS unassigned
       FROM vendor_engagement_scope_items si
       JOIN requirements r ON r.id = si.requirement_id
       JOIN frameworks f ON f.id = r.framework_id
       LEFT JOIN requirement_responses rr
              ON rr.requirement_id = si.requirement_id
             AND rr.engagement_id = si.engagement_id
             AND rr.organization_id = si.organization_id
       LEFT JOIN vendor_engagement_assignments a
              ON a.requirement_id = si.requirement_id
             AND a.engagement_id = si.engagement_id
             AND a.organization_id = si.organization_id
             AND a.superseded_at IS NULL
      WHERE si.engagement_id = $1 AND si.organization_id = $2
        AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
      GROUP BY f.id, f.name
      ORDER BY f.name`,
    [engagementId, organizationId]
  );

  const groupingAvailable = perFramework.rowCount !== null && perFramework.rowCount > 1;

  return {
    total,
    complete,
    outstanding: total - complete,
    assigned,
    unassigned: total - assigned,
    mandatory_total: Number(t.mandatory_total),
    mandatory_complete: Number(t.mandatory_complete),
    by_participant: perParticipant.rows,
    by_framework: groupingAvailable ? perFramework.rows : null,
    framework_grouping_available: groupingAvailable,
  };
}

/**
 * The frameworks a coordinator may bulk-assign, or null when grouping is not
 * meaningful. Null is the honest answer for a single-framework assessment, and
 * the UI renders it as "assign individual questions" rather than as one section.
 */
export async function assignableFrameworks(
  organizationId: string,
  engagementId: string
): Promise<Array<{ framework_id: string; framework_name: string; question_count: number }> | null> {
  const res = await pg.query<{
    framework_id: string;
    framework_name: string;
    question_count: number;
  }>(
    `SELECT f.id AS framework_id, f.name AS framework_name, COUNT(*)::int AS question_count
       FROM vendor_engagement_scope_items si
       JOIN requirements r ON r.id = si.requirement_id
       JOIN frameworks f ON f.id = r.framework_id
      WHERE si.engagement_id = $1 AND si.organization_id = $2
        AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
      GROUP BY f.id, f.name
      ORDER BY f.name`,
    [engagementId, organizationId]
  );
  return (res.rowCount ?? 0) > 1 ? res.rows : null;
}
