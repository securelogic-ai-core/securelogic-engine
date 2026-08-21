# Reporting metric definitions

**Status:** ratified with REPORT-1, 2026-08-21. Verified against `develop@732b56a7`.

**Why this exists:** a plausible but wrongly-defined metric is worse than no
metric — it gets quoted to a board. Every customer-visible number below states its
numerator, its exclusions, its time basis and its source of truth, so a reader can
check it against a query rather than trust it.

## Rules that apply to every metric

- **Tenant boundary:** every reporting query runs inside `withTenant()` /
  `asTenant()` with the RLS GUC set. No report accepts an organization
  identifier as a parameter — the org comes from the authenticated session, so
  there is no id to manipulate.
- **Severity vocabulary:** `Critical | High | Moderate | Low`, and **NULL**.
  NULL is not a fifth level: it means the finding has no canonical severity and
  therefore no SLA (see `severityNormalization.ts`). Metrics that group by
  severity must show NULL separately or state that they exclude it.
- **Zero vs unavailable:** a metric with no qualifying rows is **0**. A metric
  whose input does not exist is **unavailable** and must not render as 0.

## Executive report (`GET /api/reports/executive.pdf`)

| Metric | Definition | Source | Notes |
|---|---|---|---|
| Overall posture score | Latest snapshot's `overall_score` | `posture_snapshots` (most recent by `snapshot_date`) | **Unavailable, not 0**, when the org has no snapshot |
| Domain breakdown | `domain_scores` for that snapshot | `domain_scores` | Sums to the snapshot's `open_finding_count` |
| Open findings | `open_finding_count` **on the snapshot** | `posture_snapshots` | **Point-in-time, not live.** Can lag the findings list |
| Risks by residual rating | `COUNT(*) GROUP BY residual_rating` | `risks` | Org-scoped |
| Risks by inherent rating | `COUNT(*) GROUP BY inherent_rating` | `risks` | Org-scoped |
| Framework coverage | Per-framework rollup | `frameworks` | — |

**The most important caveat on this report:** its findings and posture numbers
come from the **latest posture snapshot**, not from a live query. If a snapshot
has not been taken since the data changed, the PDF is internally consistent but
older than the findings list. Support must not treat a discrepancy between the
two as a defect without checking snapshot age first (**SR-015**).

## Posture (`GET /api/posture/latest`, `/history`)

Same snapshot source as above, same staleness property. `/history` is the only
true time series in the product today; every other "trend" is derived from it.

## Findings metrics

| Metric | Definition | Excluded |
|---|---|---|
| Active findings | The canonical Active Findings definition (ratified) | Closed and accepted |
| By severity | `GROUP BY severity` | Must show NULL separately |
| By source | `GROUP BY source_type` | Filter vocabulary is a curated subset |
| Overdue | `due_date < CURRENT_DATE` **and** still active | Findings with **no** due date are **not overdue** — they have no SLA, which is not the same as being on time |

## Vulnerability metrics — the vocabulary is the metric

Canonical definitions live in `vulnerability-metrics-vocabulary.md` and are
enforced by test. Summarised because this is where reporting most easily lies:

**One vulnerability affecting 100 assets is 1 vulnerability, 100 affected assets,
100 occurrences. It is never "100 vulnerabilities."**

| Term | Counts |
|---|---|
| Vulnerabilities | `findings WHERE source_type='vulnerability'` |
| Affected assets | `COUNT(DISTINCT asset_id)` in `finding_asset_occurrences` |
| Occurrences | Finding-on-asset pairs, any presence |
| Active occurrences | `presence_status='present'` |
| Recurring | `reappeared_count > 0` — history, not current state |
| No longer observed | `presence_status='absent'` — **not** a remediation claim |

## Metrics that do NOT exist — do not approximate them

Named because their absence is a launch fact, not an oversight:

| Metric | Why it cannot be computed truthfully today |
|---|---|
| **SLA attainment** | Requires closure timestamps measured against the due date at closure. `findings.due_date` is mutable and closure is derived from `decision_state`; there is no stored "closed on / due on" pair |
| **MTTR** | Same gap — no reliable remediation-completed timestamp per finding |
| **Exception register metrics** | `finding_risk_acceptances` exists, but the feature is dark in production (`RISK_ACCEPTANCE_ENABLED` undeclared), so any count would be structurally 0 |
| **Risk trend over time** | Only posture has history. `risks` has no snapshot table |
| **Control effectiveness** | No effectiveness measurement is captured |
| **Vulnerability exposure over time** | Occurrence history exists per row; there is no aggregate time series |

**These must be reported as unavailable, never as 0.**
