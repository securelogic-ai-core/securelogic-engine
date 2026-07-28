# Finding→Risk Promotion — design memo (ADR-0004 A)

**Status:** implemented dark (flag `SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED`,
default off everywhere). ADR-0004 accepted for implementation by operator
ruling 2026-07-28 (rule B ratified before this memo, per the ADR's own
ordering). Capability: **Risk Lifecycle** — the conveyor between the finished
acceptance object and the Enterprise Risk Register.

## 1. Trigger

The `proposed → approved` acceptance transition, in the approve route,
immediately after the approval's audit event. Nothing else promotes: the
applicability engine still never writes risks (AD-9), and `legacy_unverified`
acceptances cannot reach the approve route (refused upstream with
`legacy_acceptance_requires_completion`) — the ADR's exclusion holds by
construction, not by flag.

## 2. Identity & dedup — create-or-link, one risk per finding

Promotion identity: `risks (organization_id, source_type='finding_promotion',
source_id=finding_id)`.

- First approval for a finding → **create** the register risk.
- Re-accepted finding (expired → re-proposed → re-approved) → **link**: the
  new acceptance's `promoted_risk_id` points at the existing risk. Never a
  second risk.
- N findings → 1 risk consolidation is a human register act (future package);
  automated merging was rejected with severity-threshold auto-creation in
  ADR-0004 ("the system derives, humans decide").
- Guard: same `INSERT … WHERE NOT EXISTS` + follow-up SELECT pattern as the
  matcher's D-14 fix. The race-proof backstop is a partial unique index on
  `(organization_id, source_id) WHERE source_type='finding_promotion'` —
  rides the same operator-approved index migration as D-14's backstop.

## 3. Field mapping

| risks column | Source | Note |
|---|---|---|
| title | finding.title | unchanged — the register names the exposure |
| description | acceptance.rationale + provenance sentence | the decision's own words |
| domain | finding.domain ?? 'General' | NOT NULL on risks |
| impact / risk_rating | finding.severity | identical vocabularies (verified) |
| likelihood | finding.likelihood via map | very_high→very_likely, high→likely, medium→possible, low→unlikely, very_low→rare; null→possible |
| status | **'accepted'** | the governed state the decision produced; in the CHECK |
| owner | acceptance owner's user name | risks.owner is TEXT; resolved via users |
| source_type/source_id | 'finding_promotion' / finding_id | the promotion identity |
| lifecycle_state | NULL while R1 dark | seeds 'accepted' when lifecycle enables (DS-8 ruling, §5) |

## 4. Approval shape (ADR-0004 B compliance)

Promotion mints **no** approval of its own — it reuses the acceptance's
approval (owner, rationale, expiry, approver, SoD). First test of the
standing rule: approval-shape count stays at three.

## 5. Risk Lifecycle interplay (DS-8)

While `SECURELOGIC_RISK_LIFECYCLE_ENABLED` is false everywhere,
`lifecycle_state` stays NULL. Enablement order (ruled): promotion first (this
memo), then lifecycle staging-enable — so the machine wakes up with an
automated inbound edge. At enablement, promoted risks seed
`lifecycle_state='accepted'`; approver model v1 = role-designated admins +
existing SoD gates (DS-8 approve-with-modification).

## 6. `risks.source_type` CHECK

ADR-0004 EXTENDS: the column's first CHECK, including 'finding_promotion'.
**Not in this change** — the column is live free text in prod; the CHECK
migration requires the prod distinct-value audit first (run
`SELECT source_type, COUNT(*) FROM risks GROUP BY 1` against prod) so the
constraint enumerates reality. Queued with the index backstop migration.

## 7. Failure & reconciliation

Promotion failure never fails the approval (the WORM governance record is
primary). Failures log `risk_promotion_failed`. Reconciliation query — any
governed decision the register is missing:

```sql
SELECT a.id, a.finding_id, a.approved_at
  FROM finding_risk_acceptances a
 WHERE a.state = 'approved' AND a.promoted_risk_id IS NULL
 ORDER BY a.approved_at;
```

Zero rows (flag-on) = the register is complete. This is also the backfill
worklist for acceptances approved before enablement.

## 8. Enablement

Staging: flag on engine service → approve a `[SEED]` acceptance → risk
appears `status='accepted'` with `source_type='finding_promotion'`;
re-approve after expiry → links, count stays 1. Then run §7 (expect zero).
Prod: per GATE discipline. Rides `docs/launch/PENDING_ENABLEMENT.md`
(arrives in PR #705; add this flag's row there once both PRs are merged).
