/**
 * briefEligibility.ts — the ONLY brief-generation eligibility computation.
 *
 * Brief generation is an organizational entitlement (ADR-0007): every active
 * platform organization gets a weekly Intelligence Brief. This is the same
 * enumeration predicate every other cross-org fan-out uses (matcher, posture
 * snapshots, SLA sweep — `organizations WHERE status = 'active'`).
 *
 * intelligence_brief_subscribers MUST NOT appear here. Subscriber rows are
 * email-recipient records consulted only by sendBrief(); an org with zero
 * recipients still generates and publishes — the skip is a delivery-health
 * condition, never a generation gate.
 *
 * Cross-org by design → pgElevated (see docs/A04-G1-table-classification.md).
 */

import { pgElevated } from "../infra/postgres.js";

/**
 * The eligibility predicate as a SQL fragment (the `sqlFindingActive` pattern):
 * any query that needs "is this org entitled to brief generation?" composes
 * this fragment instead of respelling the rule. Consumers: the scheduler
 * enumeration below; the staleness sweep (briefStalenessMonitor.ts).
 */
export function sqlBriefEligibleOrg(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `${prefix}status = 'active'`;
}

export async function listBriefEligibleOrgIds(): Promise<string[]> {
  const result = await pgElevated.query<{ id: string }>(
    `SELECT id FROM organizations WHERE ${sqlBriefEligibleOrg()} ORDER BY id`
  );
  return result.rows.map((r) => r.id);
}
