/**
 * applicabilityWorkflowDispatcher.ts — R2 (Slice 6): the LIVE workflow dispatcher.
 *
 * Bridges the pure S6 recommendation core (workflowRecommendations.ts) to the
 * platform's workflow surfaces, mirroring the 4a-core → 4c-writer split:
 *
 *   finding_draft                → findings INSERT (source_type 'applicability_assessment')
 *   risk_review_recommendation   → actions INSERT ('auto_applicability_risk_review')   — AD-9:
 *                                  a REVIEW action, never a risk row / lifecycle transition
 *   evidence_request             → actions INSERT ('auto_applicability_evidence_request')
 *   human_review_task            → actions INSERT ('auto_applicability_human_review')
 *   notification                 → AlertItem[] RETURNED to the caller, who add()s them to a
 *                                  createAlertBatcher AND flush()es AFTER the tx commits —
 *                                  notifications happen OUTSIDE the transaction (the
 *                                  alertService convention); the alert-send ledger
 *                                  (keyed per user + finding) makes sends at-most-once.
 *
 * It also writes/refreshes the human-review projection (AD-8a): one PENDING
 * signal_match_suggestions row per (org, signal, target) carrying assessment_id —
 * the accept/dismiss queue that already exists is the review surface.
 *
 * ATOMICITY: the caller invokes this INSIDE withTenant(orgId, …) — every DB write
 * (suggestion + finding + actions) commits or rolls back as one tenant transaction,
 * the same "domain record in-tx, security_audit_log mirror after commit"
 * convention as riskLifecycle.ts. The caller fires writeAuditEvent AFTER commit
 * (fire-and-forget mirrors must not record rolled-back work — the Item-1 F1 lesson).
 *
 * IDEMPOTENCY (on the recommendation key): the pure core's idempotency_key is
 * sha256(content_hash|type|target); content_hash ↔ assessment row is 1:1, and every
 * write below is ON CONFLICT-guarded on (org, assessment, type-marker) via the
 * 20260730 partial unique indexes — so re-dispatching the same stored decision is a
 * no-op, and a NEW decision (new content_hash → new assessment row) generates new work.
 *
 * FLAG-GATED at the call site: callers must check enterpriseContextEnabled() AND
 * applicabilityWorkflowEnabled() (both default OFF) before dispatching. This module
 * has no live caller until the R3 reassessment worker lands; it stays inert.
 */

import {
  deriveWorkflowRecommendations,
  DEFAULT_WORKFLOW_POLICY,
  type WorkflowPolicy,
  type WorkflowRecommendation,
  type Priority
} from "../../engine/applicability/v1/workflowRecommendations.js";
import type { StoredAssessment } from "../../engine/applicability/v1/explainability.js";
import type { Queryable } from "./applicabilityAssessmentWriter.js";
import type { AlertItem, AlertSeverity } from "./alerting/alertService.js";
import { resolveSlaDueDateWith } from "./findingSlaPolicyRules.js";
import { emitSuggestionCreated } from "./signalWebhookEmitter.js";

/** action_type markers. MUST equal the literals in the 20260730 partial unique indexes. */
export const APPLICABILITY_RISK_REVIEW_ACTION_TYPE = "auto_applicability_risk_review";
export const APPLICABILITY_EVIDENCE_ACTION_TYPE = "auto_applicability_evidence_request";
export const APPLICABILITY_HUMAN_REVIEW_ACTION_TYPE = "auto_applicability_human_review";

/** findings.source_type / actions.source_type for dispatcher-generated rows (20260730 CHECKs). */
export const APPLICABILITY_SOURCE_TYPE = "applicability_assessment";

/**
 * OFF by default everywhere; ON only for the exact string "true" — the
 * SECURELOGIC_ACTION_ENGINE_ENABLED shape, because this writes customer-facing
 * findings/actions rows automatically. Call sites must ALSO check
 * enterpriseContextEnabled() (the ECL master switch).
 */
export function applicabilityWorkflowEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED"] === "true";
}

/**
 * Recommendation priority → finding severity. Deliberately never 'Critical':
 * the applicability engine's confidence bands do not establish criticality —
 * Critical stays a human/matcher judgement (volume + credibility guard).
 */
export function priorityToFindingSeverity(p: Priority): "High" | "Moderate" | "Low" {
  return p === "high" ? "High" : p === "medium" ? "Moderate" : "Low";
}

/** Finding severity → actions.priority — reuses the platform's severityToPriority scale. */
function severityToActionPriority(severity: "High" | "Moderate" | "Low"): string {
  return severity === "High" ? "near_term" : severity === "Moderate" ? "planned" : "watch";
}

/** Applicability target type → findings.domain (the resolveSignalDomain vocabulary). */
export function targetTypeToDomain(targetType: StoredAssessment["target_type"]): string {
  switch (targetType) {
    case "vendor":
      return "Vendor Risk";
    case "ai_system":
      return "AI Governance";
    case "obligation":
      return "Regulatory";
    case "control":
    default:
      return "General";
  }
}

export interface ApplicabilityDispatchArgs {
  /** applicability_assessments.id of the stored decision being dispatched. */
  assessmentId: string;
  /** The decision as read back from the 4b tables (or as just persisted by 4c). */
  stored: StoredAssessment;
  /** Optional policy override (versioned; defaults to DEFAULT_WORKFLOW_POLICY). */
  policy?: WorkflowPolicy;
}

export interface ApplicabilityDispatchResult {
  /** All recommendations the pure core derived (before idempotency skips). */
  recommendations: WorkflowRecommendation[];
  /** 'written' = new pending suggestion; 'refreshed' = existing pending row re-pointed. */
  suggestion: { outcome: "written" | "refreshed"; id: string } | null;
  /** The generated finding (null when the decision draws no finding_draft). */
  finding: { id: string; created: boolean } | null;
  /** actions.id of rows INSERTed this dispatch (conflict-skipped rows excluded). */
  actionsCreated: string[];
  /** Count of action recommendations skipped by the ON CONFLICT idempotency guard. */
  actionsSkipped: number;
  /**
   * Alert items for the caller to add() to a createAlertBatcher AFTER the tenant
   * tx commits, then flush() — never inside the tx. Only high-priority
   * notification recommendations with a finding to anchor become alert items
   * (the alert ledger dedups per user+finding across re-dispatches); the rest
   * are counted in notificationsSkipped.
   */
  alerts: AlertItem[];
  notificationsSkipped: number;
}

/**
 * Apply the S6 recommendations for one stored applicability decision.
 * MUST be called inside withTenant(stored.organization_id, …); `db` is the
 * tenant-scoped Queryable (the `pg` proxy in prod; an app_request client in tests).
 */
export async function dispatchApplicabilityWorkflow(
  db: Queryable,
  args: ApplicabilityDispatchArgs
): Promise<ApplicabilityDispatchResult> {
  const { assessmentId, stored } = args;
  const policy = args.policy ?? DEFAULT_WORKFLOW_POLICY;
  const orgId = stored.organization_id;

  const recommendations = deriveWorkflowRecommendations(stored, policy);
  const result: ApplicabilityDispatchResult = {
    recommendations,
    suggestion: null,
    finding: null,
    actionsCreated: [],
    actionsSkipped: 0,
    alerts: [],
    notificationsSkipped: 0
  };
  if (recommendations.length === 0) return result;

  // -------------------------------------------------------------
  // 1. Human-review projection (AD-8a): one PENDING suggestion per
  //    (org, signal, target), carrying the assessment id. DO UPDATE (not the
  //    matcher's DO NOTHING): a reassessment must re-point the live pending row
  //    at the NEWEST decision so accept/dismiss always reviews current state.
  //    Terminal (accepted/dismissed) rows are outside the partial index, so a
  //    post-decision re-dispatch creates a fresh pending row (designed re-suggest).
  // -------------------------------------------------------------
  const matchMetadata = {
    source: "applicability_engine",
    decision: stored.decision,
    confidence_band: stored.confidence_band,
    content_hash: stored.content_hash,
    engine_version: stored.engine_version
  };
  const suggestionRes = await db.query(
    `INSERT INTO signal_match_suggestions (
       organization_id, signal_id, target_type, target_id,
       match_reason, match_score, match_metadata, assessment_id
     )
     VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7::jsonb, $8::uuid)
     ON CONFLICT (organization_id, signal_id, target_type, target_id)
       WHERE accepted_at IS NULL AND dismissed_at IS NULL
       DO UPDATE SET
         match_reason   = EXCLUDED.match_reason,
         match_score    = EXCLUDED.match_score,
         match_metadata = EXCLUDED.match_metadata,
         assessment_id  = EXCLUDED.assessment_id
     RETURNING id, (xmax = 0) AS inserted`,
    [
      orgId,
      stored.signal_id,
      stored.target_type,
      stored.target_id,
      "applicability_engine",
      stored.confidence,
      JSON.stringify(matchMetadata),
      assessmentId
    ]
  );
  const suggestionRow = suggestionRes.rows[0];
  if (suggestionRow) {
    result.suggestion = {
      outcome: suggestionRow.inserted === true ? "written" : "refreshed",
      id: String(suggestionRow.id)
    };
  }

  const domain = targetTypeToDomain(stored.target_type);

  // Wave-1 (DS-15): a genuinely NEW pending suggestion is customer-visible
  // review work — emit suggestion.created. Refreshes (DO UPDATE re-points the
  // live row) stay silent: the integrator already has that row. Fire-and-
  // forget, no-op while wave 1 is dark; org-scoped by construction (orgId is
  // this dispatch's tenant).
  if (suggestionRow && suggestionRow.inserted === true) {
    emitSuggestionCreated(orgId, {
      suggestion_id: String(suggestionRow.id),
      signal_id: stored.signal_id,
      match_score: stored.confidence,
      domain,
      source: "applicability_engine"
    });
  }

  // -------------------------------------------------------------
  // 2. finding_draft → findings (idempotent on (org, assessment) via the
  //    20260730 partial unique index). On conflict, fetch the existing id so
  //    notification items still anchor to the one true finding.
  // -------------------------------------------------------------
  const findingRec = recommendations.find((r) => r.type === "finding_draft");
  if (findingRec) {
    const severity = priorityToFindingSeverity(findingRec.priority);
    const title = `Applicability: signal applies to your environment (${stored.target_type})`;
    const description =
      `The applicability engine concluded '${stored.decision}' at ${stored.confidence}% confidence ` +
      `(${stored.confidence_band} band) for this ${stored.target_type}, with ` +
      `${stored.affected_entities.length} downstream entit${stored.affected_entities.length === 1 ? "y" : "ies"} ` +
      `in the blast radius. Review the decision's reasoning chain and evidence, then confirm or dismiss.`;
    // SLA policy (20260903): automated applicability findings get an
    // org-policy due date at creation (conflict = already dispatched, no touch).
    const slaDueDate = await resolveSlaDueDateWith(db, orgId, severity);
    const findingInsert = await db.query(
      `INSERT INTO findings (
         organization_id, assessment_id, source_type, source_id,
         title, description, severity, domain, priority, status, due_date
       )
       VALUES ($1, NULL, $2, $3::uuid, $4, $5, $6, $7, $8, 'open', $9)
       ON CONFLICT (organization_id, source_id)
         WHERE source_type = 'applicability_assessment'
         DO NOTHING
       RETURNING id`,
      [
        orgId,
        APPLICABILITY_SOURCE_TYPE,
        assessmentId,
        title,
        description,
        severity,
        domain,
        severityToActionPriority(severity),
        slaDueDate
      ]
    );
    const insertedFinding = findingInsert.rows[0];
    if (insertedFinding) {
      result.finding = { id: String(insertedFinding.id), created: true };
    } else {
      // Conflict — this assessment was already dispatched. Fetch the existing row.
      const existing = await db.query(
        `SELECT id FROM findings
          WHERE organization_id = $1 AND source_type = $2 AND source_id = $3::uuid
          LIMIT 1`,
        [orgId, APPLICABILITY_SOURCE_TYPE, assessmentId]
      );
      const existingRow = existing.rows[0];
      if (existingRow) result.finding = { id: String(existingRow.id), created: false };
    }
  }

  // -------------------------------------------------------------
  // 3. Action recommendations → actions (GAP-3 ON CONFLICT pattern).
  //
  // THE ACTIONS BELONG TO THE FINDING, NOT THE ASSESSMENT.
  //
  // They used to be linked to the assessment — siblings of the finding rather than
  // its children. That broke the child→parent cascade (finding-lifecycle-spec §5),
  // which only counts actions with source_type='finding'. The consequence was a
  // dead-end in the flagship workflow: an operator could close every remediation
  // action on an applicability finding and the finding would STILL sit at
  // operational_status='open' forever — never reaching `remediated`, so never
  // entering the ready-for-decision queue, and (since closure requires `remediated`
  // or `accepted_risk`) closable only by falsely accepting the risk.
  //
  // Anchoring them to the finding makes the existing cascade pick them up with no
  // new machinery: actions.ts already recomputes the parent on any finding-sourced
  // status write. When there is NO finding (no finding_draft recommendation), the
  // action still anchors to the assessment — there is no parent to roll up to.
  //
  // The dedupe indexes (20260730) are on the generic (organization_id, source_type,
  // source_id) columns, so this re-anchoring keeps idempotency: one auto-action of
  // each action_type per finding, instead of per assessment.
  const actionAnchor = result.finding
    ? { sourceType: "finding", sourceId: result.finding.id }
    : { sourceType: APPLICABILITY_SOURCE_TYPE, sourceId: assessmentId };

  const ACTION_MAP: Partial<Record<WorkflowRecommendation["type"], { actionType: string; title: string; description: string }>> = {
    risk_review_recommendation: {
      actionType: APPLICABILITY_RISK_REVIEW_ACTION_TYPE,
      title: `Review risk exposure: applicability decision on ${stored.target_type}`,
      description:
        `An applicability decision ('${stored.decision}', ${stored.confidence}% confidence) recommends a ` +
        `risk review for this ${stored.target_type}. Risk creation/transition stays human-gated (AD-9) — ` +
        `review the decision and open or update a risk if warranted.`
    },
    evidence_request: {
      actionType: APPLICABILITY_EVIDENCE_ACTION_TYPE,
      title: `Collect evidence: applicability decision on ${stored.target_type}`,
      description:
        `Collect corroborating evidence for the applicability decision on this ${stored.target_type} ` +
        `(decision '${stored.decision}', ${stored.confidence}% confidence).`
    },
    human_review_task: {
      actionType: APPLICABILITY_HUMAN_REVIEW_ACTION_TYPE,
      title: `Human review: applicability decision on ${stored.target_type}`,
      description:
        `The applicability engine routed this ${stored.target_type} to human review ` +
        `(decision '${stored.decision}', ${stored.confidence}% confidence). Review the reasoning chain ` +
        `and accept or dismiss the match suggestion.`
    }
  };

  for (const rec of recommendations) {
    const mapped = ACTION_MAP[rec.type];
    if (!mapped) continue;
    const severity = priorityToFindingSeverity(rec.priority);
    const actionInsert = await db.query(
      `INSERT INTO actions (
         organization_id, title, description, action_type,
         source_type, source_id, priority, status
       )
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, 'open')
       ON CONFLICT (organization_id, source_type, source_id)
         WHERE action_type = '${mapped.actionType}'
         DO NOTHING
       RETURNING id`,
      [
        orgId,
        mapped.title,
        mapped.description,
        mapped.actionType,
        actionAnchor.sourceType,
        actionAnchor.sourceId,
        severityToActionPriority(severity)
      ]
    );
    const actionRow = actionInsert.rows[0];
    if (actionRow) result.actionsCreated.push(String(actionRow.id));
    else result.actionsSkipped++;
  }

  // -------------------------------------------------------------
  // 4. notification recommendations → AlertItems (returned; sent OUTSIDE the tx).
  //    The batcher's KIND_CONFIG severities are Critical/High only, and the
  //    ledger dedup key is finding-anchored — so only high-priority notification
  //    recs with a generated finding become alert items. Lower-priority
  //    notifications remain visible via the suggestion + action queues.
  // -------------------------------------------------------------
  // The pure core emits one notification rec per blast-radius identity; the
  // alert service selects recipients by ORG preference (not per identity), so
  // N identity notifications coalesce to ONE finding-anchored alert item.
  let alertPushed = false;
  for (const rec of recommendations) {
    if (rec.type !== "notification") continue;
    const severity = priorityToFindingSeverity(rec.priority);
    if (severity !== "High" || result.finding === null || alertPushed) {
      result.notificationsSkipped++;
      continue;
    }
    alertPushed = true;
    result.alerts.push({
      findingId: result.finding.id,
      title: `Applicability: signal applies to your environment (${stored.target_type})`,
      severity: severity as AlertSeverity,
      domain
    });
  }

  return result;
}
