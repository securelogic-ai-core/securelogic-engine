/**
 * independentReviewFeatureFlag.ts — SECURELOGIC_INDEPENDENT_REVIEW_ENABLED.
 *
 * Gates the Independent Governance Review WORKFLOW (assignment + waiting-state UI +
 * reviewer queue + dashboard metric + assignment audit/notification), NOT the SoD
 * enforcement itself. The org policy that DECIDES whether a finding needs independent
 * review is the existing `risk_settings.require_finding_closure_sod` — this code flag
 * only decides whether the new workflow SURFACES around that already-enforced rule.
 *
 * Flag OFF (production, initially) — byte-identical to before this package. The close-time
 * SoD gate still enforces (a remediator who tries to self-close still gets the 409); we
 * simply do not auto-assign a reviewer, do not derive the "Pending Independent Review"
 * presentation, and do not add any query to the recompute hot path.
 *
 * Flag ON (staging first) — reaching `operational_status='remediated'` in an org that
 * enforces `require_finding_closure_sod` auto-assigns a Closure Owner (admin ≠ remediator),
 * the remediator sees a waiting state instead of a dead Resolved control, and the reviewer
 * gets a queue + notification.
 *
 * Enabling in production is a separate operator ruling, after staging validation.
 */

export function independentReviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_INDEPENDENT_REVIEW_ENABLED"] === "true";
}
