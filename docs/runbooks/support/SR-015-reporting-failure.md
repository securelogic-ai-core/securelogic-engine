# SR-015 — Dashboard, report or export fails or looks wrong

| | |
|---|---|
| **Playbook ID** | SR-015 |
| **Domain** | Reporting / Analytics |
| **Severity default** | SEV3; **SEV2** if a board or audit deadline depends on it |
| **Owning level** | L1 triage → L2 → Engineering |
| **Release dependency** | Exports and posture are live today. **Executive Risk nav is `false` in production** — discoverable only after that flag is flipped at promotion |
| **Feature flag** | `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` (app) — nav entry only; the page itself is entitlement-gated |
| **Last validated** | 2026-08-21 against `develop@732b56a7` (staging: trends 200, posture 200, executive PDF 200 / 7 pages) |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

Dashboard won't load · a number "looks wrong" · report generation fails · PDF
won't download · CSV export fails or is empty · **the summary disagrees with the
list you drill into** · an expected section is missing.

## The one that is usually NOT a bug

> **"The executive report says 12 open findings but my findings list shows 15."**

The executive report and the posture dashboard read the **latest posture
snapshot**, which is point-in-time. The findings list is **live**. If no snapshot
has been taken since the data changed, both are correct and simply describe
different moments.

**Ask first: when was the last posture snapshot?** Do not escalate this as a data
defect until that is ruled out. *(L1 OBSERVABLE — the snapshot date is on the
posture view.)*

## Likely causes

1. **Snapshot staleness** — see above. Most common "wrong number" report.
2. **Entitlement** — executive reporting requires premium/team/platform. A lower
   tier is redirected to the dashboard, which looks like a missing feature.
3. **Nav flag off** — in production the Executive entry is hidden by design until
   activated. The page still exists at its URL for entitled users.
4. **Genuinely no data** — a new tenant with no snapshot shows *unavailable*, not
   zero. If it shows 0 where nothing is configured, that **is** a defect.
5. **Metric misread** — especially vulnerabilities: 1 vulnerability on 100 assets
   is **not** 100 vulnerabilities. See §Vocabulary.
6. Platform issue → **SR-008**.

## Safe diagnostic steps

1. **Which surface** — dashboard, executive report, PDF, or CSV? *(L1 OBSERVABLE.)*
2. **Which exact number, and what did they compare it to?** *(L1 OBSERVABLE.)*
3. **Snapshot date** vs when the data changed. *(L1 OBSERVABLE.)*
4. **Their plan tier** — premium/team/platform for executive reporting.
   *(L1 OBSERVABLE.)*
5. **One export or all?** All → **SR-008**. *(L1 OBSERVABLE.)*
6. Engine-side report assembly errors — *(L2/ENGINEERING ONLY.)*

## Vocabulary — get this right in writing

| Term | Means |
|---|---|
| Vulnerabilities | Distinct vulnerability findings |
| Affected assets | Distinct hosts carrying at least one |
| Occurrences | Vulnerability-on-asset pairs — the unit of work |
| Active occurrences | Currently observed |
| No longer observed | A scan covered the asset and didn't find it — **not** "fixed" |

**Never write "N vulnerabilities" when N is an asset or occurrence count.** It
overstates the customer's risk picture by orders of magnitude.

## Metrics that do not exist

If a customer asks for **SLA attainment, MTTR, exception counts, risk trend over
time, or control effectiveness** — these are **not computed today**. Say so.
Do not point at a number that looks similar. See
`docs/specs/reporting-metric-definitions.md`.

## Approved L1 actions

Explain snapshot staleness · confirm tier · confirm which metric they mean ·
retry a single export once · escalate.

## Actions L1 must NOT perform

- **trigger a posture snapshot** to "refresh" the number — snapshot cadence is
  operational, and forcing one changes the customer's history
- regenerate a report through any privileged path
- recompute or hand-calculate a number and give it to the customer as
  authoritative — if the product can't produce it, support quoting it is worse
- explain a discrepancy as a bug before checking snapshot age

## Escalate when

The summary and the drilldown disagree **and** snapshot age does not explain it ·
PDF generation fails repeatedly · an export contains records from another
organization → **SR-009, SEV1** · a metric shows 0 where the domain is not
configured.

## Recovery

**None validated (SUP-PROC-1).** Report regeneration and snapshot scheduling are
Engineering.

## Recovery verification

The customer opens the report/export and confirms the number matches what they
drilled into.

## Customer communication

> "Those two numbers come from different places — the executive report is a
> point-in-time snapshot, and the findings list is live. Let me check when your
> last snapshot was taken; that usually explains the gap, and if it doesn't I'll
> escalate it."

## Observability

| Signal | Where | Level |
|---|---|---|
| Snapshot date | Posture view | **L1** |
| Plan tier | Account page | **L1** |
| Report/export error on screen | Customer | **L1** |
| Report assembly errors | Engine logs | L2 |
| Snapshot scheduler outcome | Engine logs | L2 |

**Missing:** L1 cannot see whether a posture snapshot succeeded or when the next
is due — the single most common question in this runbook (**SUP-OBS-22**).

## Related

SR-008, SR-024 · `docs/specs/reporting-metric-definitions.md` ·
`vulnerability-metrics-vocabulary.md` · `src/api/routes/executiveReport.ts`
