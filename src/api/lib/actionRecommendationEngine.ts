/**
 * actionRecommendationEngine.ts — GAP-3: the "what to do next" engine.
 *
 * The platform already MATCHES signals to entities and SURFACES them as findings
 * (cyberSignalProcessingService.ts). What was missing is the third step: turning a
 * matched, surfaced finding into a concrete, trackable ACTION a customer can work.
 * The `actions` table + CRUD API already exist (manual only); this module is the
 * first generator that writes `actions` rows automatically.
 *
 * INCREMENT 1 — finding → action.
 * When the matcher creates a finding for a matched signal, generate a
 * "review and remediate" action linked to that finding (source_type='finding',
 * source_id=finding.id), but ONLY for high-signal findings (Critical/High) so the
 * action queue stays meaningful. Risk/obligation/assessment generators are later
 * increments (delivery-readiness 3c).
 *
 * SAFETY (consistent with the Phase-2 fuzzy matcher):
 *   - OFF by default behind SECURELOGIC_ACTION_ENGINE_ENABLED — auto-populating
 *     every org's action queue is a real behavior change; enable per-env after
 *     reviewing volume.
 *   - Idempotent: the caller INSERTs ON CONFLICT against the partial unique index
 *     idx_actions_generated_finding (org, source_type, source_id) WHERE
 *     action_type = GENERATED_FINDING_ACTION_TYPE — so a re-processed signal does
 *     not duplicate the action, and a user's manual finding-action (different
 *     action_type) never collides with a generated one.
 *
 * Pure builder + an env read. No DB/IO here — the matcher owns the INSERT inside
 * its tenant transaction.
 */

/** action_type marker stamped on generated finding-actions. MUST equal the literal in the partial unique index (migration 20260625) and the caller's ON CONFLICT predicate. */
export const GENERATED_FINDING_ACTION_TYPE = "auto_finding_remediation";

/** action_type marker for generated risk-exposure actions (increment 2). MUST equal the literal in idx_actions_generated_risk (migration 20260627). */
export const GENERATED_RISK_ACTION_TYPE = "auto_risk_exposure";

/** action_type marker for generated obligation-review actions (increment 3). MUST equal the literal in idx_actions_generated_obligation (migration 20260628). */
export const GENERATED_OBLIGATION_ACTION_TYPE = "auto_obligation_review";

/**
 * Minimum obligation match score to spawn an action. Obligation matching is
 * suggest-only and produces up to SUGGESTION_CAP candidates per signal at
 * MIN_MATCH_SCORE (40); generating an action for each would flood the queue.
 * 80 = a confident regulation-FAMILY citation (REGULATION_BASE_SCORE), not a weak
 * domain-only tiebreak — so only high-confidence regulatory hits become actions.
 */
export const ACTION_OBLIGATION_MIN_SCORE = 80;

/** Severities that warrant an auto-generated action. Moderate/Low are surfaced as findings but do not spawn queue items. */
const ACTIONABLE_SEVERITIES = new Set<string>(["Critical", "High"]);

/**
 * OFF by default everywhere; ON only for the exact string "true". Stricter than
 * flags that default-on outside production, because this writes customer-facing
 * action rows.
 */
export function actionEngineEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_ACTION_ENGINE_ENABLED"] === "true";
}

export type FindingActionInput = {
  /** findings.id — becomes the action's source_id. */
  findingId: string;
  /** finding title (already composed by the matcher). */
  title: string;
  /** Critical | High | Moderate | Low. */
  severity: string;
  /** immediate | near_term | planned | watch — already mapped from severity. */
  priority: string;
};

export type ActionDraft = {
  title: string;
  description: string;
  action_type: string;
  source_type: "finding" | "risk" | "obligation";
  source_id: string;
  priority: string;
};

/**
 * Build the action a finding should spawn, or null if the finding does not meet
 * the actionable-severity threshold. Pure and deterministic.
 */
export function buildFindingActionDraft(
  finding: FindingActionInput
): ActionDraft | null {
  if (!ACTIONABLE_SEVERITIES.has(finding.severity)) return null;

  return {
    title: `Review and remediate: ${finding.title}`,
    description:
      `An open ${finding.severity}-severity finding requires action. Confirm the ` +
      `exposure from the matched signal, then remediate or formally accept the risk.`,
    action_type: GENERATED_FINDING_ACTION_TYPE,
    source_type: "finding",
    source_id: finding.findingId,
    priority: finding.priority
  };
}

// ---------------------------------------------------------------------------
// buildRiskActionDraft (pure — increment 2)
// ---------------------------------------------------------------------------

/**
 * Build the action a newly exposure-flagged risk should spawn. Exposure flagging
 * (a matched signal hitting an open risk in the matched domain) is itself the
 * trigger — no severity threshold; the flag means it's relevant. Flat near_term
 * priority (a live signal exposing an open risk warrants near-term review).
 */
export function buildRiskActionDraft(riskId: string, domain: string): ActionDraft {
  return {
    title: `Review exposed risk (${domain})`,
    description:
      `A matched signal flagged exposure on this open ${domain} risk. Review it, ` +
      `confirm the exposure, and remediate or formally re-accept the risk.`,
    action_type: GENERATED_RISK_ACTION_TYPE,
    source_type: "risk",
    source_id: riskId,
    priority: "near_term"
  };
}

// ---------------------------------------------------------------------------
// buildObligationActionDraft (pure — increment 3)
// ---------------------------------------------------------------------------

/**
 * Build the action a high-confidence obligation match should spawn, or null
 * below ACTION_OBLIGATION_MIN_SCORE. Only the TOP obligation match per signal
 * should be passed here (the caller picks scored[0]) to keep the queue meaningful.
 */
export function buildObligationActionDraft(
  obligationId: string,
  label: string,
  score: number
): ActionDraft | null {
  if (score < ACTION_OBLIGATION_MIN_SCORE) return null;

  const reg = label.trim().length > 0 ? label.trim() : "a tracked obligation";
  return {
    title: `Assess regulatory change against ${reg}`,
    description:
      `A regulatory-change signal matched ${reg}. Review whether it affects this ` +
      `obligation and update your compliance assessment.`,
    action_type: GENERATED_OBLIGATION_ACTION_TYPE,
    source_type: "obligation",
    source_id: obligationId,
    priority: "near_term"
  };
}
