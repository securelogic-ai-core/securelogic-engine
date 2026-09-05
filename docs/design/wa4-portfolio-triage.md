# WA-4 — Portfolio Navigation and Triage

Pre-implementation brief, owner ruling 5 (2026-09-05). Written before the code
and kept as the design record.

---

## 1. Current engagement-list architecture

`GET /api/vendor-engagements` (`vendorEngagements.ts:listEngagements`) took two
parameters — `status` and `limit` (capped 200) — and ordered by
`COALESCE(residual_score, inherent_score, 0) DESC, created_at DESC`. No sort
parameter, no offset, no tiebreak, no triage signal beyond the two the
monitoring sweeps already write: `review_overdue` (a derived boolean on
`status='monitoring' AND next_review_due < CURRENT_DATE`) and
`reassessment_recommended_at`.

The app surface `/vendor-engagements` rendered a table with one control: state
filter chips, each linking to `?status=<state>` — which **discarded** any other
parameter, because there was only ever one. Every route sits behind the same
chain: `vendorAssuranceFeatureFlag → requireApiKey → attachOrganizationContext
→ requireEntitlement("premium") → denyContributor()`, wrapped in `asTenant`.

## 2. Current canonical response states

`requirement_responses.status`, read through
`responseCompleteness.RESPONSE_ANSWERS` = `pass | partial | fail |
not_applicable`. The legacy `not_assessed` is not an answer — `isResponseAnswer`
rejects it, so it reads as unanswered. `question_versions.evidence_policy`
(`none | optional | required_on_pass | required_always`) is the only
per-question modifier, and WA-1 is its first and only consumer.

## 3. Evidence and finding relationships relevant to triage

- `evidence.reviewed_at` — NULL means attached but unconfirmed. Its column
  comment is explicit that it is *"deliberately NOT set by upload"*: it is the
  difference between "they attached something" and "somebody checked".
- `findings` with `source_type='vendor_engagement'` and
  `source_id = <engagement id>`, written **only** by
  `POST /vendor-engagements/:id/promote-findings`. Nothing else in the codebase
  calls `promoteEngagementFindings` — verified by grep across `src/` and
  `app/src/`; the only other reference is the app's own explicit action.
- "Active" is not re-decided here: `sqlFindingActive()`
  (`metricDefinitions.ts:112`) is the platform-wide predicate,
  `operational_status <> 'closed'`, converged in PR #645.

## 4. The deterministic Needs Attention rule

**Window** — reasons are evaluated only in `submitted`, `in_review`,
`clarification_requested`, `analysis_complete`, `decision_pending`. Narrow on
purpose: before `submitted` the vendor is still answering and every unanswered
item would read as a defect; after `decided` the engagement has its own signals,
and re-flagging a decided engagement forever because it once had a `fail` makes
the badge meaningless within a quarter.

**Reasons**, in analyst-urgency order:

| reason | predicate |
|---|---|
| `control_not_in_place` | `status = 'fail'` |
| `partial_response` | `status = 'partial'` |
| `explanation_missing` | `explanationRequired(answer, policy) && !hasExplanation(notes)` — imported from `responseCompleteness.ts`, not re-decided |
| `unanswered_mandatory` | `mandatory && !isResponseAnswer(status)` |
| `evidence_unreviewed` | engagement `evidence` rows with `reviewed_at IS NULL` |
| `active_finding` | findings from this engagement where `sqlFindingActive()` |

`needs_attention` is `reasons.length > 0`. Nothing is stored: it is recomputed
on every read.

**Deliberately excluded:** `not_applicable` on its own. WA-1 already forces it
to carry an explanation, so an unexplained one surfaces as
`explanation_missing` — the honest reason — while an explained one is a decision
the analyst can read. Flagging every N/A would make the highest-integrity answer
a vendor can give look like a defect.

**The digest** is `reason:count|reason:count` in vocabulary order, `none` when
empty. Deliberately not a hash: it is readable in a log and in a database row,
and a human comparing two dispositions can see what moved.

### The one compromise, stated rather than hidden

`attentionSignals.ts` is the vocabulary authority and the reference
implementation. The **list** endpoint cannot call it per row — filtering and
sorting by attention must happen in the database or pagination stops being
correct — so `listEngagements` computes the same counts in SQL. That is two
implementations of one rule. It is made safe by
`test/isolation/vendorEngagementTriage.test.ts`, which runs both over the same
fixtures and fails the build on any disagreement.

## 5. Human disposition

`reviewed | accepted | escalated | finding_proposed | finding_confirmed`.

Stored in `vendor_engagement_dispositions` (migration `20261093`),
**append-only** via the shared `worm_guard_mutation`, `app_request` granted
`SELECT, INSERT` only. Changing your mind writes a new row; the current
disposition is the latest; every prior decision stays readable with its actor,
time and reason. That is a stronger reading of "preserve meaningful disposition
history" than an UPDATE plus a shadow table.

Every disposition except `reviewed` requires a rationale of ≥10 characters — the
same bar as `overrideInherent`, the WA-2 challenge and the WA-3 reseed.
`disposed_by_user_id` is NOT NULL with ON DELETE RESTRICT, so an API-key-only
caller is refused at the route with a message that says why rather than at the
database.

`attention_digest` stores the derived state the decision was made against, by
value. When the assessment moves, the surface reports `stale: true` and keeps
the decision — it does not silently invalidate a real human judgement.

## 6. Persistence, audit, authorization

RLS `USING`/`WITH CHECK` on `app.current_org_id`; a `BEFORE INSERT` trigger
re-checks that the engagement belongs to the writing tenant, because a
governance record that can point at another tenant's engagement is not an audit
trail. Audit event `vendor_engagement.disposition_recorded`. Data-classification
entry: category C, `piiRisk: low`, `userRefColumns: [disposed_by_user_id]`.

## 7. API surface

`GET /api/vendor-engagements` gains `sort`, `order`, `offset`,
`needs_attention` (tri-state), `undisposed`; each row gains `attention` and
`disposition`; the body gains `query` (what the server actually did) and
`has_more`.

`GET /api/vendor-engagements/:id/attention` — reasons with labels, details and
the requirement references behind them.
`POST /api/vendor-engagements/:id/disposition` — record one.
`GET /api/vendor-engagements/:id/dispositions` — the append-only trail.

**Whitelist:** `ENGAGEMENT_SORTS` is a closed map from key to a **fixed** SQL
fragment. No client string reaches the query; an unknown key falls back to the
default rather than being interpolated, so there is no path from a query
parameter to a SQL fragment even if upstream validation were removed. Sorts:
`risk` (default), `attention`, `updated`, `created`, `next_review`, `vendor`;
`order` is `asc | desc`. Every fragment ends with `e.id`, making the order total
— without that tiebreak an offset-paginated page boundary between two equal
scores can repeat or skip a row.

## 8. UI surfaces changed

- `app/src/app/vendor-engagements/page.tsx` — needs-attention and
  not-yet-dispositioned filters, six sort controls with direction toggle,
  reason chips with counts, a disposition column with a staleness chip, and
  offset pagination. Every control links through `withQuery()`, which merges
  rather than replaces, so choosing a sort cannot discard the filter just set.
- `app/src/components/vendorEngagements/AttentionPanel.tsx` (new) — the detail
  explanation and the disposition form.
- `app/src/app/vendor-engagements/[id]/page.tsx` — renders the panel above the
  action panel; triage precedes acting on it.
- `app/src/lib/api.ts`, `app/src/lib/vendorEngagements.ts`,
  `app/src/app/actions/vendorEngagements.ts`.

Two WA-3 lessons are load-bearing in the panel: the success message renders
**before** any early return, so revalidation cannot unmount the sentence the
analyst is still reading; and there is **no** `router.refresh()` after the
action, because `revalidatePath` already streams the revalidated page in the
same response and a refresh supersedes it mid-flight.

## 9. Migrations

One: `20261093_vendor_engagement_dispositions.sql`, additive, empty at birth,
nothing backfilled. Rollback: `docs/release/ROLLBACK-20261093.sql`.

## 10. Tests

- `src/api/__tests__/attentionSignals.test.ts` — 23 unit cases over the pure
  module.
- `test/isolation/vendorEngagementTriage.test.ts` — 18 cases: SQL/module
  equivalence, the no-auto-Finding proof, append-only and WORM refusal,
  attribution, the rationale gate, staleness, cross-tenant 404 on all three new
  routes, the sort whitelist (including an injection attempt), pagination
  stability, and the tri-state filter.
- `scripts/validation/wa4-portfolio-triage-staging-journey.mjs` — the deployed
  browser journey, Chromium and WebKit.

## 11. Risks and conflicts

- **Query cost.** The list adds four lateral joins per row. Bounded by `limit`
  (≤200) and indexed on `(organization_id, engagement_id)` paths that already
  exist. The alternative — deriving in Node — breaks pagination, which is worse.
- **One more read on the engagement page**, which already fans out under a
  120/min per-user JWT limiter. The journey paces accordingly; the standing
  fan-out note applies unchanged.
- **The dual implementation** is the real risk, and the equivalence test is the
  mitigation. It is stated in the module header so nobody discovers it by
  surprise.
- **No conflict found** with the methodology, the tenant model or historical
  reproducibility. WA-4 reads canonical response *state* and never requirement
  *text*, so the IA-1 versioning gap does not make it unsafe to build
  independently — which is the determination the owner asked for before
  splitting IA-1 out.

## 12. No automatic Finding creation is introduced

Confirmed three ways: `promoteEngagementFindings` gains no new caller; the
disposition route writes to exactly one table and returns `created_finding:
false` in its own body; and the finding count is measured before and after every
triage operation in both the isolation suite and the deployed journey.
