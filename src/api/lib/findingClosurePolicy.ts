/**
 * findingClosurePolicy.ts — THE ONE closure policy. SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED.
 *
 * THE RULE (approved 2026-07-14)
 *
 *   A Finding may not transition to closed while its remediation Actions remain
 *   incomplete — UNLESS the risk is formally accepted.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN `if` IN THE ROUTE
 *
 * A Finding can be closed on more than one axis, and the axes must not disagree about what
 * closure requires — a rule enforced on one path is not a rule, it is a speed bump with a
 * detour. The closure paths, and how each one satisfies this policy:
 *
 *   1. LEGACY `status` axis — PATCH /api/findings/:id {"status":"closed"|"accepted"}.
 *      Had NO gate. Through the compat bridge it force-writes operational_status='closed',
 *      so it closed a Finding with open remediation outright: operational_status stopped
 *      being system-derived (a client dictated it), and the Finding's own Actions were left
 *      OPEN under a closed parent, sitting in their owner's My Actions queue forever.
 *      THIS is the hole this policy closes. It calls evaluateFindingClosure() below.
 *
 *   2. GOVERNANCE axis — PATCH /api/findings/:id {"decision_state":"resolved"} and the bulk
 *      `decide` op. Already gated, by evaluateFindingDecisionTransition: it demands
 *      operational_status === 'remediated' (which deriveOperationalStatus only yields when
 *      EVERY linked Action is terminal) OR decision_state === 'accepted_risk'. That is the
 *      SAME rule as this one, expressed on the derived status instead of a live count — so
 *      the governance axis is already compliant and is deliberately left untouched. Its
 *      gate is unflagged and shipped; re-routing it through a flag would make an existing
 *      enforced rule newly bypassable when the flag is off, which is a regression, not a
 *      rollout.
 *
 *   3. RISK-ACCEPTANCE approval — POST /api/risk-acceptances/:id/approve. Closes via
 *      hasBindingAcceptance. This is an APPROVED GOVERNANCE CLOSURE PATH and must keep
 *      working: an approved, unexpired acceptance IS the decision that no remediation
 *      remains. It is not a bypass of the rule, it is the rule's second limb — which is
 *      exactly why `hasBindingAcceptance` is an input to evaluateFindingClosure() and not
 *      an exception carved around it.
 *
 * The three paths therefore share ONE definition of "remediation is complete", and it lives
 * here. A second copy could drift, and drift re-opens the hole.
 *
 * REQUIRED vs OPTIONAL REMEDIATION
 *
 * The `actions` model does NOT distinguish required from optional/advisory work. There is
 * no `required` / `blocking` / `mandatory` column: the only ALTERs ever applied to `actions`
 * widen the `source_type` CHECK. `priority` ('immediate'|'near_term'|'planned'|'watch')
 * exists but is a scheduling hint that no closure logic has ever consulted.
 *
 * So this policy treats EVERY linked, non-terminal Action as blocking, which is the same
 * set deriveOperationalStatus already refuses to call 'remediated'. Introducing a
 * required/optional split here would invent a distinction the domain model cannot express
 * and would silently disagree with the governance axis. If the product later needs advisory
 * Actions, that is a schema change plus a change to BOTH limbs — not a special case here.
 *
 * FLAG
 *
 * This rule changes a customer-reachable API contract: a PATCH that returned 200 today can
 * return 409 tomorrow. So it ships dark.
 *
 *   OFF (default, everywhere, including production) — legacy behaviour, byte for byte. The
 *     gate is not merely bypassed, it is never consulted: no blocker query is issued, so
 *     there is not even an extra round trip, and no 409 can be produced.
 *   ON (staging first) — the rule above is enforced, with a stable machine-readable code.
 *
 * Absent reads false. Enabling in production is a separate operator ruling, taken only
 * after staging validation and an inventory of the clients that would start seeing 409s.
 */

import type { PoolClient, Pool } from "pg";

import { sqlActionActive } from "./metricDefinitions.js";
import { SQL_ACCEPTANCE_BINDING } from "./riskAcceptanceContract.js";

export const FINDING_CLOSURE_GATE_FLAG = "SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED";

/**
 * The stable, machine-readable refusal code. Integrations branch on this string, so it is a
 * contract: it may be added to, never renamed.
 */
export const CLOSE_REQUIRES_REMEDIATION_COMPLETE = "close_requires_remediation_complete";

export function findingClosureGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[FINDING_CLOSURE_GATE_FLAG] === "true";
}

/** The facts the policy needs. Gathered by loadClosureBlockers(), or supplied by a caller. */
export interface ClosureBlockers {
  /** Linked Actions in a non-terminal state — `status IN ('open','in_progress','blocked')`. */
  openActions: number;
  /** An approved, unexpired risk acceptance currently holds this Finding closed. */
  hasBindingAcceptance: boolean;
}

export interface ClosureRefusal {
  error: typeof CLOSE_REQUIRES_REMEDIATION_COMPLETE;
  open_actions: number;
  message: string;
}

export type ClosureDecision =
  | { allowed: true }
  | { allowed: false; httpStatus: 409; body: ClosureRefusal };

/**
 * THE POLICY. Pure — no I/O, no env, no flag. The flag decides whether a caller CONSULTS
 * the policy; it does not live inside it, so the rule stays testable as a rule.
 *
 * Closure is permitted when EITHER limb holds:
 *   - no incomplete remediation remains (including the no-Actions case: a false positive,
 *     or a Finding that needed no remediation, is not blocked by a rule about FINISHING
 *     remediation); OR
 *   - the risk is formally accepted — a binding, approved, unexpired acceptance.
 */
export function evaluateFindingClosure(blockers: ClosureBlockers): ClosureDecision {
  const { openActions, hasBindingAcceptance } = blockers;

  if (openActions <= 0 || hasBindingAcceptance) {
    return { allowed: true };
  }

  const plural = openActions === 1 ? "" : "s";
  return {
    allowed: false,
    httpStatus: 409,
    body: {
      error: CLOSE_REQUIRES_REMEDIATION_COMPLETE,
      open_actions: openActions,
      // Say what to DO, not just what was refused. No internals, no ids — this reaches
      // customers and their integrations.
      message:
        `This finding still has ${openActions} open remediation action${plural}. ` +
        `Close or cancel ${openActions === 1 ? "it" : "them"}, or record an approved ` +
        `risk acceptance, before closing the finding.`,
    },
  };
}

/**
 * Gather the blockers for one Finding, in the CALLER'S tenant context.
 *
 * Tenant isolation: every predicate is org-scoped explicitly (organization_id = $1), and the
 * client passed in is the request's tenant-routed client — so this is safe under RLS whether
 * the tables' policies are enabled or not. Never call this with an elevated client.
 *
 * `hasBindingAcceptance` is resolved ONLY when the risk-acceptance feature is live for the
 * caller; when it is not, an acceptance row cannot close a Finding anywhere else in the
 * system either (recomputeFindingOperationalStatus applies the same condition), and treating
 * one as binding here would let a dark feature unlock a closure the derivation would then
 * refuse to honour. The two must agree.
 */
export async function loadClosureBlockers(
  client: Pick<PoolClient | Pool, "query">,
  organizationId: string,
  findingId: string,
  opts: { acceptanceEnabled: boolean }
): Promise<ClosureBlockers> {
  const acceptanceExpr = opts.acceptanceEnabled
    ? `EXISTS (SELECT 1 FROM finding_risk_acceptances a
                WHERE a.organization_id = $1 AND a.finding_id = $2
                  AND ${SQL_ACCEPTANCE_BINDING})`
    : `FALSE`;

  const res = await client.query<{ open_actions: string; accepted: boolean }>(
    `SELECT
       (SELECT COUNT(*) FROM actions
         WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2
           AND ${sqlActionActive()})   AS open_actions,
       ${acceptanceExpr}               AS accepted`,
    [organizationId, findingId]
  );

  return {
    openActions: parseInt(res.rows[0]?.open_actions ?? "0", 10),
    hasBindingAcceptance: res.rows[0]?.accepted === true,
  };
}
